import { AppError } from '@agentpm/shared';
import type { Prisma } from '@agentpm/db';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/** 保存的过滤器（M6）：项目内保存 SearchIssuesQuery 快照，本人或 shared 可见。 */
export async function createFilter(
  ctx: Ctx,
  projectKey: string,
  input: { name: string; query: Record<string, unknown>; shared?: boolean },
) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (!ctx.actorId) throw new Error('unauthorized');
  const dup = await ctx.db.savedFilter.findFirst({
    where: { projectId: project.id, ownerId: ctx.actorId, name: input.name },
  });
  if (dup) throw AppError.conflict(`同名过滤器已存在：${input.name}`, 'FILTER_EXISTS');
  return ctx.db.savedFilter.create({
    data: {
      projectId: project.id,
      name: input.name.slice(0, 64),
      query: input.query as Prisma.InputJsonValue,
      ownerId: ctx.actorId,
      shared: input.shared ?? false,
    },
  });
}

export async function listFilters(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const rows = await ctx.db.savedFilter.findMany({
    where: {
      projectId: project.id,
      ...(ctx.actorId ? { OR: [{ ownerId: ctx.actorId }, { shared: true }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { owner: { select: { name: true, displayName: true } } },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    query: f.query,
    shared: f.shared,
    owner: f.owner.name,
    mine: f.ownerId === ctx.actorId,
  }));
}

export async function deleteFilter(ctx: Ctx, projectKey: string, filterId: string) {
  const { project, member } = await requireProjectMembership(ctx, projectKey);
  const filter = await ctx.db.savedFilter.findFirst({
    where: { id: filterId, projectId: project.id },
  });
  if (!filter) throw AppError.notFound('过滤器不存在', 'FILTER_NOT_FOUND');
  const isAdmin = member?.role === 'ADMIN' || member?.role === 'OWNER';
  if (filter.ownerId !== ctx.actorId && !isAdmin)
    throw AppError.forbidden('只能删除自己的过滤器', 'NOT_OWNER');
  await ctx.db.savedFilter.delete({ where: { id: filter.id } });
  return { ok: true };
}
