import type { SprintStatus } from '@agentpm/shared';
import type { CreateSprintInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { requireProjectMembership } from './project.service.js';

export async function listSprints(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const sprints = await ctx.db.sprint.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { issues: true } },
    },
  });
  return sprints.map((s) => ({
    id: s.id,
    name: s.name,
    goal: s.goal,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    issueCount: s._count.issues,
  }));
}

export async function getCurrentSprint(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const sprint = await ctx.db.sprint.findFirst({
    where: { projectId: project.id, status: 'ACTIVE' },
    include: {
      issues: {
        include: {
          state: { select: { name: true, category: true } },
          assignee: { select: { name: true, type: true } },
        },
      },
    },
  });
  if (!sprint) return null;
  const byCategory = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
  for (const i of sprint.issues) byCategory[i.state.category]++;
  return {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    startsAt: sprint.startsAt,
    endsAt: sprint.endsAt,
    status: sprint.status,
    totals: { ...byCategory, total: sprint.issues.length },
    issues: sprint.issues.map((i) => ({
      issueKey: i.issueKey,
      title: i.title,
      type: i.type,
      priority: i.priority,
      state: i.state.name,
      stateCategory: i.state.category,
      assignee: i.assignee?.name ?? null,
      assigneeType: i.assignee?.type ?? null,
    })),
  };
}

export async function createSprint(ctx: Ctx, projectKey: string, input: CreateSprintInput) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const sprint = await ctx.db.sprint.create({ data: { projectId: project.id, ...input } });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'sprint.created',
    summary: `创建 Sprint ${sprint.name}（${sprint.status}）`,
  });
  return sprint;
}

export async function setSprintStatus(
  ctx: Ctx,
  projectKey: string,
  sprintId: string,
  status: SprintStatus,
) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const sprint = await ctx.db.sprint.findFirst({ where: { id: sprintId, projectId: project.id } });
  if (!sprint) throw new Error('sprint not found');
  const updated = await ctx.db.sprint.update({ where: { id: sprintId }, data: { status } });
  await writeActivity(ctx, {
    projectId: project.id,
    action: 'sprint.status_changed',
    summary: `Sprint ${sprint.name}: ${sprint.status} → ${status}`,
  });
  return updated;
}

/** backlog：未排期（无 sprint）且未完成的 issue。 */
export async function listBacklog(
  ctx: Ctx,
  projectKey: string,
  opts: { type?: string; label?: string } = {},
) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const issues = await ctx.db.issue.findMany({
    where: {
      projectId: project.id,
      sprintId: null,
      state: { category: { not: 'DONE' } },
      ...(opts.type ? { type: opts.type as never } : {}),
      ...(opts.label ? { labels: { some: { label: { name: opts.label } } } } : {}),
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    include: {
      state: { select: { name: true, category: true } },
      assignee: { select: { name: true, type: true } },
      labels: { include: { label: { select: { name: true } } } },
    },
  });
  return issues.map((i) => ({
    issueKey: i.issueKey,
    title: i.title,
    type: i.type,
    priority: i.priority,
    state: i.state.name,
    assignee: i.assignee?.name ?? null,
    labels: i.labels.map((l) => l.label.name),
  }));
}
