import type { Prisma } from '@agentpm/db';
import { AppError, type BugReportInput, parseProjectSettings } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { addComment } from './comment.service.js';
import { createIssue, serializeIssue, type IssueDetail } from './issue.service.js';
import { requireProjectMembership } from './project.service.js';

export interface BugReportResult {
  status: 'created' | 'deduplicated' | 'pending_approval';
  issue?: ReturnType<typeof serializeIssue>;
  duplicateOf?: string;
  approvalId?: string;
  message: string;
}

/**
 * agent/人 提 bug：
 * - fingerprint 去重：同项目内未关闭的同指纹 BUG → 追加证据评论，不重复建单；
 * - 项目策略 bugCreate=approval 且提交者是 agent → 进入审批队列。
 */
export async function reportBug(
  ctx: Ctx,
  projectKey: string,
  input: BugReportInput,
): Promise<BugReportResult> {
  const { project, member } = await requireProjectMembership(ctx, projectKey, 'MEMBER');
  const settings = parseProjectSettings(project.settings);
  const isAgentActor = ctx.actorType === 'AGENT' || ctx.actorType === 'AVATAR';

  if (isAgentActor && settings.agentPolicy.bugCreate === 'approval') {
    const approval = await ctx.db.approvalRequest.create({
      data: {
        projectId: project.id,
        requestedById: ctx.actorId!,
        actionType: 'bug.create',
        payload: { projectKey, ...input } as unknown as Prisma.InputJsonValue,
      },
    });
    await writeActivity(ctx, {
      projectId: project.id,
      action: 'approval.requested',
      summary: `agent 请求提 bug「${input.title}」（待审批）`,
      detail: { approvalId: approval.id, actionType: 'bug.create' },
    });
    return {
      status: 'pending_approval',
      approvalId: approval.id,
      message: '项目策略要求 agent 提 bug 需人工审批，请求已进入审批队列',
    };
  }

  return fileBugInternal(ctx, project.id, projectKey, input, member !== null);
}

/** 实际建单（含指纹去重）。供 reportBug 与审批通过后代执行、回归自动建单复用。 */
export async function fileBugInternal(
  ctx: Ctx,
  projectId: string,
  projectKey: string,
  input: BugReportInput,
  isMember: boolean,
): Promise<BugReportResult> {
  if (!isMember && !ctx.actorId) throw AppError.unauthorized();

  if (input.fingerprint) {
    const dup = await ctx.db.issue.findFirst({
      where: {
        projectId,
        type: 'BUG',
        fingerprint: input.fingerprint,
        state: { category: { not: 'DONE' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (dup) {
      await addComment(ctx, dup.issueKey, {
        body: `重复上报（指纹 ${input.fingerprint}），已并入本单。\n\n${input.description ?? ''}${
          input.stepsToReproduce ? `\n\n**复现步骤**\n${input.stepsToReproduce}` : ''
        }`,
        evidence: input.evidence,
      });
      await writeActivity(ctx, {
        projectId,
        issueId: dup.id,
        action: 'bug.deduplicated',
        summary: `重复 bug 并入 ${dup.issueKey}（指纹 ${input.fingerprint}）`,
      });
      return {
        status: 'deduplicated',
        duplicateOf: dup.issueKey,
        message: `发现未关闭的同指纹 bug，已作为证据并入 ${dup.issueKey}`,
      };
    }
  }

  const description = [
    input.description,
    input.stepsToReproduce ? `## 复现步骤\n${input.stepsToReproduce}` : null,
    input.evidence
      ? `## 证据\n\`\`\`json\n${JSON.stringify(input.evidence, null, 2).slice(0, 4000)}\n\`\`\``
      : null,
    input.environment ? `**环境**：${input.environment}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const labels = [...new Set([...input.labelNames, ...(input.fingerprint ? [] : [])])];
  const issue: IssueDetail = await createIssue(ctx, projectKey, {
    type: 'BUG',
    title: input.title,
    description: description || undefined,
    priority: input.severity,
    labelNames: labels,
    fingerprint: input.fingerprint,
    environment: input.environment,
    parentIssueKey: input.parentIssueKey,
  });
  return {
    status: 'created',
    issue: serializeIssue(issue),
    message: `已创建 ${issue.issueKey}`,
  };
}
