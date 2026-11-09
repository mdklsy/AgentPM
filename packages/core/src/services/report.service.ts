import type { Prisma } from '@agentpm/db';
import { AppError, type CreateReportInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { notify, projectAdmins } from './notification.service.js';
import { requireProjectMembership } from './project.service.js';
import { emitWebhook } from './webhook.service.js';

/**
 * PM 替身报告（M5，ADR 0005）：
 * - 由 avatar-worker 经 REST 创建（因此同样进审计）；人也可手工发布；
 * - 发布即通知负责人（avatar 的 owner）与项目管理员，并推 webhook。
 */
export async function createReport(
  ctx: Ctx,
  projectKey: string,
  input: CreateReportInput,
  /** 额外审计信息（如手动巡检的触发者） */
  opts: { via?: string } = {},
) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  if (!ctx.actorId) throw AppError.unauthorized();

  const report = await ctx.db.report.create({
    data: {
      projectId: project.id,
      authorId: ctx.actorId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
  });

  await writeActivity(ctx, {
    projectId: project.id,
    action: 'report.published',
    summary: `${ctx.actorName ?? '未知'} 发布${input.kind === 'RISK_ALERT' ? '风险告警' : '日报'}：${input.title}`,
    detail: { reportId: report.id, kind: input.kind, ...(opts.via ? { via: opts.via } : {}) },
  });
  emitWebhook(ctx, 'report.published', {
    projectKey,
    reportId: report.id,
    kind: input.kind,
    title: input.title,
    author: ctx.actorName,
  });

  // 通知：项目管理员 + （若作者是替身）替身的 owner
  const recipients = await projectAdmins(ctx, project.id);
  if (ctx.actorType === 'AVATAR') {
    const profile = await ctx.db.agentProfile.findUnique({ where: { actorId: ctx.actorId } });
    if (profile) recipients.push(profile.ownerId);
  }
  await notify(ctx, recipients, 'report.published', {
    projectKey,
    reportId: report.id,
    kind: input.kind,
    title: input.title,
  });

  return report;
}

export async function listReports(ctx: Ctx, projectKey: string, limit = 20) {
  const { project } = await requireProjectMembership(ctx, projectKey);
  const reports = await ctx.db.report.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { author: { select: { name: true, displayName: true, type: true } } },
  });
  return reports.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    content: r.content,
    data: r.data,
    author: { name: r.author.name, displayName: r.author.displayName, type: r.author.type },
    createdAt: r.createdAt,
  }));
}
