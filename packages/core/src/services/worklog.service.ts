import { AppError } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { getIssueOr404 } from './issue.service.js';
import { requireProjectMembership } from './project.service.js';
import { writeActivity } from './activity.service.js';

/** 工时登记（M6）：人工登记实际耗时；issue.estimateMinutes 为预估。 */
export interface AddWorklogInput {
  minutes: number;
  spentAt?: Date;
  comment?: string;
}

export async function addWorklog(ctx: Ctx, issueKey: string, input: AddWorklogInput) {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key, 'MEMBER');
  if (!ctx.actorId) throw AppError.unauthorized();
  if (input.minutes < 1 || input.minutes > 100_000)
    throw AppError.badRequest('工时分钟数需在 1-100000 之间', 'MINUTES_INVALID');
  const log = await ctx.db.worklog.create({
    data: {
      issueId: issue.id,
      actorId: ctx.actorId,
      minutes: input.minutes,
      ...(input.spentAt ? { spentAt: new Date(input.spentAt) } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    },
  });
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'worklog.added',
    summary: `${ctx.actorName ?? '未知'} 在 ${issue.issueKey} 登记工时 ${input.minutes} 分钟`,
    detail: { issueKey: issue.issueKey, minutes: input.minutes },
  });
  return log;
}

export async function listWorklogs(ctx: Ctx, issueKey: string) {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key);
  const logs = await ctx.db.worklog.findMany({
    where: { issueId: issue.id },
    orderBy: { spentAt: 'desc' },
    include: { actor: { select: { name: true, displayName: true } } },
  });
  return logs.map((l) => ({
    id: l.id,
    actor: l.actor.name,
    displayName: l.actor.displayName,
    minutes: l.minutes,
    spentAt: l.spentAt,
    comment: l.comment,
  }));
}
