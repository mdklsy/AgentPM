import type { StateCategory } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 项目统计：整体进度 + 人机负载分配 + agent 状态 + 活跃度。
 * 监控中心与 PM 替身（M5）共用此口径。
 */
export async function projectStats(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);

  const [
    byTypeGroups,
    byStateGroups,
    byPriorityGroups,
    workloadRaw,
    agentMembers,
    activeSprint,
    recentActivities,
  ] = await Promise.all([
    ctx.db.issue.groupBy({ by: ['type'], where: { projectId: project.id }, _count: true }),
    ctx.db.issue.groupBy({ by: ['stateId'], where: { projectId: project.id }, _count: true }),
    ctx.db.issue.groupBy({ by: ['priority'], where: { projectId: project.id }, _count: true }),
    ctx.db.issue.findMany({
      where: { projectId: project.id, state: { category: { not: 'DONE' } } },
      select: {
        assignee: { select: { name: true, displayName: true, type: true } },
        state: { select: { category: true } },
      },
    }),
    ctx.db.member.findMany({
      where: { projectId: project.id, actor: { type: 'AGENT' } },
      include: {
        actor: {
          select: {
            name: true,
            displayName: true,
            agentProfile: { select: { lastHeartbeatAt: true, status: true } },
          },
        },
      },
    }),
    ctx.db.sprint.findFirst({
      where: { projectId: project.id, status: 'ACTIVE' },
      include: { issues: { include: { state: { select: { category: true } } } } },
    }),
    ctx.db.activity.findMany({
      where: { projectId: project.id, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      select: { source: true, actorId: true },
    }),
  ]);

  // 状态类别统计（按 stateId 聚合后归类到看板三列）
  const stateIds = byStateGroups.map((g) => g.stateId);
  const states = stateIds.length
    ? await ctx.db.workflowState.findMany({
        where: { id: { in: stateIds } },
        select: { id: true, category: true },
      })
    : [];
  const categoryOf = new Map(states.map((s) => [s.id, s.category]));
  const categoryCounts: Record<StateCategory, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  for (const g of byStateGroups) categoryCounts[categoryOf.get(g.stateId) ?? 'TODO'] += g._count;

  const totalIssues = byTypeGroups.reduce((s, g) => s + g._count, 0);
  const done = categoryCounts.DONE;

  // 负载：未完成 issue 按负责人（人/agent 分开统计）
  const workload = new Map<
    string,
    { name: string; type: string; open: number; inProgress: number }
  >();
  for (const i of workloadRaw) {
    if (!i.assignee) continue;
    const w = workload.get(i.assignee.name) ?? {
      name: i.assignee.name,
      type: i.assignee.type,
      open: 0,
      inProgress: 0,
    };
    if (i.state.category === 'IN_PROGRESS') w.inProgress++;
    else w.open++;
    workload.set(i.assignee.name, w);
  }
  const unassigned = workloadRaw.filter((i) => !i.assignee).length;

  const activityBySource = { WEB: 0, API: 0, MCP: 0, SYSTEM: 0 };
  for (const a of recentActivities) activityBySource[a.source]++;

  return {
    project: project.key,
    name: project.name,
    totals: {
      total: totalIssues,
      done,
      todo: categoryCounts.TODO,
      inProgress: categoryCounts.IN_PROGRESS,
      completionRate: totalIssues ? Math.round((done / totalIssues) * 100) : 0,
    },
    byType: Object.fromEntries(byTypeGroups.map((g) => [g.type, g._count])) as Record<
      string,
      number
    >,
    byPriority: Object.fromEntries(byPriorityGroups.map((g) => [g.priority, g._count])) as Record<
      string,
      number
    >,
    workload: {
      unassigned,
      members: [...workload.values()].sort(
        (a, b) => b.open + b.inProgress - (a.open + a.inProgress),
      ),
    },
    agents: agentMembers.map((m) => ({
      name: m.actor.name,
      displayName: m.actor.displayName,
      status: m.actor.agentProfile?.status ?? 'unknown',
      lastHeartbeatAt: m.actor.agentProfile?.lastHeartbeatAt ?? null,
      activeIssues: workload.get(m.actor.name)
        ? workload.get(m.actor.name)!.open + workload.get(m.actor.name)!.inProgress
        : 0,
    })),
    sprint: activeSprint
      ? (() => {
          const sc: Record<StateCategory, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
          for (const i of activeSprint.issues) sc[i.state.category]++;
          return {
            id: activeSprint.id,
            name: activeSprint.name,
            endsAt: activeSprint.endsAt,
            totals: { ...sc, total: activeSprint.issues.length },
          };
        })()
      : null,
    activity7d: { total: recentActivities.length, bySource: activityBySource },
  };
}
