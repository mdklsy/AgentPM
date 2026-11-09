import { AppError, type ApprovalDecisionInput, type BugReportInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { fileBugInternal } from './bug.service.js';
import { transitionIssue } from './issue.service.js';
import { requireProjectMembership } from './project.service.js';

/** 审批队列（ADMIN+ 查看；agent 可查看自己发起的）。 */
export async function listApprovals(
  ctx: Ctx,
  projectKey: string,
  opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'; onlyMine?: boolean } = {},
) {
  const { project, member } = await requireProjectMembership(ctx, projectKey);
  const isAdmin = member?.role === 'ADMIN' || member?.role === 'OWNER';
  const items = await ctx.db.approvalRequest.findMany({
    where: {
      projectId: project.id,
      ...(opts.status ? { status: opts.status } : {}),
      ...(!isAdmin || opts.onlyMine ? { requestedById: ctx.actorId! } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      requestedBy: { select: { name: true, displayName: true, type: true } },
      decidedBy: { select: { name: true } },
    },
  });
  return items.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    payload: a.payload,
    status: a.status,
    requestedBy: a.requestedBy.name,
    requestedByType: a.requestedBy.type,
    decidedBy: a.decidedBy?.name ?? null,
    decidedAt: a.decidedAt,
    reason: a.reason,
    createdAt: a.createdAt,
  }));
}

/** 审批决策：APPROVED 时由系统代为执行（source=SYSTEM，动作归属于原发起 agent）。 */
export async function decideApproval(ctx: Ctx, approvalId: string, input: ApprovalDecisionInput) {
  const approval = await ctx.db.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { project: true },
  });
  if (!approval) throw AppError.notFound('审批请求不存在', 'APPROVAL_NOT_FOUND');
  await requireProjectMembership(ctx, approval.project.key, 'ADMIN');
  if (approval.status !== 'PENDING')
    throw AppError.conflict(`该请求已处理（${approval.status}）`, 'ALREADY_DECIDED');

  let execution: Record<string, unknown> = {};
  if (input.decision === 'APPROVED') {
    // 代执行上下文：动作仍归属发起的 agent，但来源标记为 SYSTEM
    const execCtx: Ctx = { ...ctx, source: 'SYSTEM' };
    if (approval.actionType === 'issue.transition') {
      const p = approval.payload as { issueKey: string; toState: string; comment?: string | null };
      const r = await transitionIssue(execCtx, p.issueKey, p.toState, p.comment ?? undefined, {
        bypassPolicy: true,
      });
      execution = { status: r.status, issueKey: p.issueKey };
    } else if (approval.actionType === 'bug.create') {
      const p = approval.payload as BugReportInput;
      const r = await fileBugInternal(execCtx, approval.projectId, approval.project.key, p, true);
      execution = { status: r.status, issueKey: r.issue?.issueKey ?? r.duplicateOf ?? null };
    } else {
      throw AppError.internal(`未知审批动作类型：${approval.actionType}`);
    }
  }

  await ctx.db.approvalRequest.update({
    where: { id: approvalId },
    data: {
      status: input.decision,
      decidedById: ctx.actorId,
      decidedAt: new Date(),
      reason: input.reason,
    },
  });
  await writeActivity(ctx, {
    projectId: approval.projectId,
    action: 'approval.decided',
    summary: `审批 ${approval.actionType} → ${input.decision}${input.reason ? `：${input.reason}` : ''}`,
    detail: { approvalId, execution },
  });
  return { approvalId, decision: input.decision, execution };
}
