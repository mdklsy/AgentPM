import { AppError } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/** 版本 Release（M6）：issue 的发布容器，Sprint 之外的第二维度。 */
export interface CreateReleaseInput {
  name: string;
  releaseDate?: string | null;
  description?: string | null;
}

export async function createRelease(ctx: Ctx, projectKey: string, input: CreateReleaseInput) {
  const { member, project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (member?.role !== 'ADMIN' && member?.role !== 'OWNER')
    throw AppError.forbidden('需要项目 ADMIN 及以上权限', 'ADMIN_REQUIRED');
  const dup = await ctx.db.release.findFirst({
    where: { projectId: project.id, name: input.name },
  });
  if (dup) throw AppError.conflict(`版本 ${input.name} 已存在`, 'RELEASE_EXISTS');
  return ctx.db.release.create({
    data: {
      projectId: project.id,
      name: input.name,
      ...(input.releaseDate ? { releaseDate: new Date(input.releaseDate) } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

export async function listReleases(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const releases = await ctx.db.release.findMany({
    where: { projectId: project.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { issues: { select: { id: true, state: { select: { category: true } } } } },
  });
  return releases.map((r) => {
    const total = r.issues.length;
    const done = r.issues.filter((i) => i.state.category === 'DONE').length;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      releaseDate: r.releaseDate,
      description: r.description,
      totalIssues: total,
      doneIssues: done,
      createdAt: r.createdAt,
    };
  });
}

export async function updateRelease(
  ctx: Ctx,
  projectKey: string,
  releaseId: string,
  input: {
    name?: string;
    status?: 'planned' | 'released' | 'archived';
    releaseDate?: string | null;
    description?: string | null;
  },
) {
  const { member, project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (member?.role !== 'ADMIN' && member?.role !== 'OWNER')
    throw AppError.forbidden('需要项目 ADMIN 及以上权限', 'ADMIN_REQUIRED');
  const release = await ctx.db.release.findFirst({
    where: { id: releaseId, projectId: project.id },
  });
  if (!release) throw AppError.notFound('版本不存在', 'RELEASE_NOT_FOUND');
  return ctx.db.release.update({
    where: { id: release.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.releaseDate !== undefined
        ? { releaseDate: input.releaseDate ? new Date(input.releaseDate) : null }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

export async function deleteRelease(ctx: Ctx, projectKey: string, releaseId: string) {
  const { member, project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (member?.role !== 'ADMIN' && member?.role !== 'OWNER')
    throw AppError.forbidden('需要项目 ADMIN 及以上权限', 'ADMIN_REQUIRED');
  const release = await ctx.db.release.findFirst({
    where: { id: releaseId, projectId: project.id },
  });
  if (!release) throw AppError.notFound('版本不存在', 'RELEASE_NOT_FOUND');
  await ctx.db.release.delete({ where: { id: release.id } }); // issue.releaseId 由 SetNull 自动清
  return { ok: true };
}
