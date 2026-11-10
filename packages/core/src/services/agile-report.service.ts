import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 敏捷报表（M6）：控制图（周期时长）、累积流图、Epic 进度。
 * 复用燃尽的"审计流回放"骨架：从 issue.transitioned 事件重建每个 issue 的
 * joinedAt（进入看板）/ doneAt（进入 DONE）/ 各状态时间。
 */

export interface CycleTimePoint {
  issueKey: string;
  title: string;
  type: string;
  /** 进入完成态的时间戳 */
  doneAt: string;
  /** 从进入看板到完成的日历天数（含小数） */
  cycleDays: number;
}

interface EventRow {
  issueId: string | null;
  createdAt: Date;
  detail: unknown;
}

export async function agileReport(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);

  const [states, issues, events] = await Promise.all([
    ctx.db.workflowState.findMany({
      where: { workflow: { projectId: project.id } },
      select: { name: true, category: true },
    }),
    ctx.db.issue.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        issueKey: true,
        title: true,
        type: true,
        parentIssueId: true,
        createdAt: true,
        closedAt: true,
        state: { select: { category: true } },
      },
    }),
    ctx.db.activity.findMany({
      where: { projectId: project.id, action: 'issue.transitioned' },
      orderBy: { createdAt: 'asc' },
      select: { issueId: true, createdAt: true, detail: true },
    }),
  ]);

  const categoryOf = new Map(
    states.map((s) => [s.name, s.category as 'TODO' | 'IN_PROGRESS' | 'DONE']),
  );
  // 每 issue 的事件流（issueId 可空的活动直接跳过）
  const byIssue = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.issueId) continue;
    const list = byIssue.get(e.issueId) ?? [];
    list.push(e);
    byIssue.set(e.issueId, list);
  }

  const now = Date.now();
  const cycleTimes: CycleTimePoint[] = [];
  const cfdDays = new Map<string, { todo: number; inProgress: number; done: number }>();
  let minDay: string | null = null;
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  for (const issue of issues) {
    // 逐事件回放状态变化
    let doneAt: Date | null = null;
    const events = (byIssue.get(issue.id) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // 初始类别：issue 创建时视为 TODO（近似；首次 transition 事件会纠正）
    let currentCat: 'TODO' | 'IN_PROGRESS' | 'DONE' = 'TODO';
    const joinedAt: Date = issue.createdAt;
    const timeline: Array<{ at: Date; cat: 'TODO' | 'IN_PROGRESS' | 'DONE' }> = [
      { at: issue.createdAt, cat: currentCat },
    ];
    for (const e of events) {
      const to = (e.detail as { to?: string } | null)?.to;
      if (!to) continue;
      const cat = categoryOf.get(to);
      if (!cat || cat === currentCat) continue;
      currentCat = cat;
      timeline.push({ at: e.createdAt, cat });
      if (cat === 'DONE') doneAt = e.createdAt;
      else doneAt = null; // reopen
    }

    // 控制图：已完成 issue 的周期
    if (doneAt && joinedAt) {
      cycleTimes.push({
        issueKey: issue.issueKey,
        title: issue.title,
        type: issue.type,
        doneAt: doneAt.toISOString(),
        cycleDays: Math.max(0.1, (doneAt.getTime() - joinedAt.getTime()) / 86_400_000),
      });
    }

    // CFD 贡献：按「天结束时状态」投影——每天恰好计 1 次，历史日期用当天最后一次流转
    const firstDay = dayKey(issue.createdAt);
    if (!minDay || firstDay < minDay) minDay = firstDay;
    for (
      let d = new Date(`${firstDay}T00:00:00.000Z`);
      d.getTime() <= now;
      d = new Date(d.getTime() + 86_400_000)
    ) {
      const dayEnd = d.getTime() + 86_400_000 - 1; // 当天最后一毫秒
      let cat: 'TODO' | 'IN_PROGRESS' | 'DONE' = 'TODO';
      for (const t of timeline) {
        if (t.at.getTime() <= dayEnd) cat = t.cat;
        else break;
      }
      const key = dayKey(d);
      const bucket = cfdDays.get(key) ?? { todo: 0, inProgress: 0, done: 0 };
      bucket[cat === 'DONE' ? 'done' : cat === 'IN_PROGRESS' ? 'inProgress' : 'todo'] += 1;
      cfdDays.set(key, bucket);
    }
  }

  // Epic 进度：Epic + 递归子孙
  const epics = issues.filter((i) => i.type === 'EPIC');
  const childrenOf = new Map<string | null, string[]>();
  for (const i of issues) {
    const list = childrenOf.get(i.parentIssueId) ?? [];
    list.push(i.id);
    childrenOf.set(i.parentIssueId, list);
  }
  const byId = new Map(issues.map((i) => [i.id, i]));
  const epicStats = epics.map((e) => {
    const seen = new Set<string>();
    const stack = [...(childrenOf.get(e.id) ?? [])];
    let total = 0;
    let done = 0;
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const child = byId.get(id);
      if (!child) continue;
      total += 1;
      if (child.state.category === 'DONE') done += 1;
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return { key: e.issueKey, title: e.title, total, done };
  });

  const cfd = [...cfdDays.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  return {
    cycleTimes: cycleTimes.sort((a, b) => a.doneAt.localeCompare(b.doneAt)),
    cfd,
    epics: epicStats,
  };
}
