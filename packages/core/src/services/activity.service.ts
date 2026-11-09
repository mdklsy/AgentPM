import type { Prisma } from '@agentpm/db';

import { ActivityQuerySchema } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';

export interface WriteActivityInput {
  projectId: string;
  issueId?: string | null;
  action: string;
  summary: string;
  detail?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

/**
 * 统一审计写入：服务层所有写操作调用它。
 * Ctx 的 actor/token/ip/ua/mcpTool 自动并入 meta，来源并入 source。
 */
export async function writeActivity(ctx: Ctx, input: WriteActivityInput) {
  const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
  if (ctx.ip) meta.ip = ctx.ip;
  if (ctx.userAgent) meta.userAgent = ctx.userAgent;
  if (ctx.mcpTool) meta.mcpTool = ctx.mcpTool;

  return ctx.db.activity.create({
    data: {
      projectId: input.projectId,
      issueId: input.issueId ?? undefined,
      actorId: ctx.actorId ?? undefined,
      apiTokenId: ctx.apiTokenId ?? undefined,
      action: input.action,
      summary: input.summary.slice(0, 512),
      detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      source: ctx.source,
      meta: meta as Prisma.InputJsonValue,
    },
  });
}

/** 项目活动流查询（人机同源 feed）。 */
export async function queryActivities(ctx: Ctx, projectKey: string, rawQuery: unknown) {
  const q = ActivityQuerySchema.parse(rawQuery ?? {});
  const project = await ctx.db.project.findUnique({ where: { key: projectKey } });
  if (!project) return { project: null, items: [], query: q };

  const where: Prisma.ActivityWhereInput = {
    projectId: project.id,
    ...(q.actor ? { actor: { name: q.actor } } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.issueKey ? { issue: { issueKey: q.issueKey } } : {}),
    ...(q.before ? { createdAt: { lt: q.before } } : {}),
  };

  const items = await ctx.db.activity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    include: {
      actor: { select: { id: true, name: true, displayName: true, type: true } },
      issue: { select: { issueKey: true, title: true, type: true } },
    },
  });
  return { project, items, query: q };
}
