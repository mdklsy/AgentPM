import { AppError } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 燃尽图 / 速率（M4）—— 不存快照表，直接从审计流（Activity）重建历史：
 * 这是"审计先行"（ADR 0004）的直接红利，任何时刻都能回放项目的过去。
 *
 * 算法：对 Sprint 内每个 issue 回放事件流（创建 + 状态迁移），
 * 得到它在任意日期是否处于 DONE；remaining(D) = 已进入(D) - 已完成且未重开(D)。
 */
export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  remaining: number;
  ideal: number;
}

export async function sprintBurndown(ctx: Ctx, projectKey: string, sprintId: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const sprint = await ctx.db.sprint.findFirst({
    where: { id: sprintId, projectId: project.id },
    include: { issues: { select: { id: true, issueKey: true, createdAt: true } } },
  });
  if (!sprint) throw AppError.notFound('sprint 不存在', 'SPRINT_NOT_FOUND');

  const now = new Date();
  const start = atDayStart(sprint.startsAt ?? sprint.createdAt);
  // 未结束的 sprint 燃到今天；已结束的燃到结束日
  const end = sprint.endsAt && sprint.endsAt < now ? atDayEnd(sprint.endsAt) : atDayEnd(now);

  // 状态名 → 类别映射
  const states = await ctx.db.workflowState.findMany({
    where: { workflow: { projectId: project.id } },
    select: { name: true, category: true },
  });
  const categoryOf = new Map(states.map((s) => [s.name, s.category]));

  // 每个 issue 的"进入/完成"时间线
  const issueIds = sprint.issues.map((i) => i.id);
  const transitions = issueIds.length
    ? await ctx.db.activity.findMany({
        where: { issueId: { in: issueIds }, action: 'issue.transitioned' },
        orderBy: { createdAt: 'asc' },
        select: { issueId: true, createdAt: true, detail: true },
      })
    : [];

  interface Timeline {
    joinedAt: Date;
    doneAt: Date | null;
  }
  const timelines = new Map<string, Timeline>();
  for (const i of sprint.issues) {
    const joined = i.createdAt < start ? new Date(start) : new Date(i.createdAt);
    timelines.set(i.id, { joinedAt: joined, doneAt: null });
  }
  for (const t of transitions) {
    if (!t.issueId) continue;
    const tl = timelines.get(t.issueId);
    if (!tl) continue;
    const to = (t.detail as { to?: string } | null)?.to;
    if (!to) continue;
    const isDone = categoryOf.get(to) === 'DONE';
    if (isDone && !tl.doneAt) tl.doneAt = t.createdAt;
    if (!isDone && tl.doneAt) tl.doneAt = null; // reopen
  }

  const total = sprint.issues.length;
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const points: BurndownPoint[] = [];
  for (let d = 0; d <= days; d++) {
    const day = new Date(start.getTime() + d * 86_400_000);
    const dayEnd = atDayEnd(day).getTime();
    let done = 0;
    let joined = 0;
    for (const tl of timelines.values()) {
      if (tl.joinedAt.getTime() <= dayEnd) joined++;
      if (tl.doneAt && tl.doneAt.getTime() <= dayEnd) done++;
    }
    points.push({
      date: day.toISOString().slice(0, 10),
      remaining: joined - done,
      ideal: Math.round((total * (days - d)) / days),
    });
  }

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startsAt: sprint.startsAt,
      endsAt: sprint.endsAt,
    },
    total,
    scopeNote: total ? undefined : 'Sprint 暂无 issue，先从 Backlog 排入任务',
    points,
  };
}

/** 速率：各已完成 Sprint 期间完成（并保持完成）的 issue 数。 */
export async function velocity(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const sprints = await ctx.db.sprint.findMany({
    where: { projectId: project.id, status: 'COMPLETED' },
    orderBy: { endsAt: 'asc' },
    include: { issues: { select: { id: true } } },
  });
  if (!sprints.length) return { items: [] };

  // 完成时刻 = issue.transitioned → DONE 的最近一次且未再离开（近似：closedAt 非空）
  const allIssueIds = sprints.flatMap((s) => s.issues.map((i) => i.id));
  const closedIssues = allIssueIds.length
    ? await ctx.db.issue.findMany({
        where: { id: { in: allIssueIds }, closedAt: { not: null } },
        select: { id: true, closedAt: true },
      })
    : [];
  const closedAtOf = new Map(closedIssues.map((i) => [i.id, i.closedAt!]));

  const items = sprints.map((s) => {
    const from = s.startsAt ?? s.createdAt;
    const to = s.endsAt ?? new Date();
    const done = s.issues.filter((i) => {
      const closed = closedAtOf.get(i.id);
      return closed && closed >= from && closed <= to;
    }).length;
    return { sprintId: s.id, name: s.name, endsAt: s.endsAt, total: s.issues.length, done };
  });
  return { items };
}

function atDayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function atDayEnd(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
