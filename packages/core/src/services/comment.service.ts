import type { Prisma } from '@agentpm/db';
import { type CreateCommentInput, type ProgressReportInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';
import { writeActivity } from './activity.service.js';
import { getIssueOr404 } from './issue.service.js';
import { issueAudience, notify } from './notification.service.js';
import { requireProjectMembership } from './project.service.js';
import { emitWebhook } from './webhook.service.js';

async function resolveIssue(ctx: Ctx, issueKey: string) {
  const issue = await getIssueOr404(ctx, issueKey);
  const project = await ctx.db.project.findUniqueOrThrow({
    where: { id: issue.projectId },
    select: { key: true },
  });
  await requireProjectMembership(ctx, project.key, 'MEMBER');
  return issue;
}

export async function addComment(ctx: Ctx, issueKey: string, input: CreateCommentInput) {
  const issue = await resolveIssue(ctx, issueKey);
  const projectKey = (
    await ctx.db.project.findUniqueOrThrow({
      where: { id: issue.projectId },
      select: { key: true },
    })
  ).key;
  const comment = await ctx.db.comment.create({
    data: {
      issueId: issue.id,
      authorId: ctx.actorId!,
      body: input.body,
      evidence: (input.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    include: { author: { select: { name: true, displayName: true, type: true } } },
  });
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'comment.added',
    summary: `${comment.author.name} 评论 ${issueKey}`,
    detail: { hasEvidence: !!input.evidence },
  });
  emitWebhook(ctx, 'comment.added', {
    projectKey,
    issueKey,
    author: comment.author.name,
    authorType: comment.author.type,
  });
  const audience = await issueAudience(ctx, issue);
  await notify(ctx, audience, 'comment.added', { issueKey, author: comment.author.name });

  // @提及（M6）：解析 body 中的 @账号名，限项目成员内匹配，单独提醒
  const mentioned = [...new Set(input.body.matchAll(/@([a-z][a-z0-9-]{1,63})/g))]
    .map((m) => m[1]!)
    .filter((n) => n !== comment.author.name);
  if (mentioned.length) {
    const members = await ctx.db.member.findMany({
      where: { projectId: issue.projectId, actor: { name: { in: mentioned }, isActive: true } },
      select: { actorId: true },
    });
    if (members.length)
      await notify(
        ctx,
        members.map((m) => m.actorId),
        'comment.mentioned',
        { issueKey, projectKey, title: issue.title, by: comment.author.name },
      );
  }
  return comment;
}

/** 结构化进度汇报（agent 主用，人也可用）。 */
export async function reportProgress(ctx: Ctx, issueKey: string, input: ProgressReportInput) {
  const issue = await resolveIssue(ctx, issueKey);
  const report = await ctx.db.progressReport.create({
    data: {
      issueId: issue.id,
      actorId: ctx.actorId!,
      percent: input.percent,
      notes: input.notes,
      blockers: input.blockers,
      artifacts: input.artifacts,
    },
  });
  await writeActivity(ctx, {
    projectId: issue.projectId,
    issueId: issue.id,
    action: 'progress.reported',
    summary: `${issueKey} 进度 ${input.percent}%${input.blockers.length ? '（有阻塞项）' : ''}`,
    detail: {
      percent: input.percent,
      blockers: input.blockers.length,
      artifacts: input.artifacts.length,
    },
  });
  emitWebhook(ctx, 'progress.reported', {
    projectKey: (
      await ctx.db.project.findUniqueOrThrow({
        where: { id: issue.projectId },
        select: { key: true },
      })
    ).key,
    issueKey,
    percent: input.percent,
    blockers: input.blockers.length,
  });
  if (input.blockers.some((b) => b.issueKey)) {
    // 阻塞项指向其他 issue → 建立 BLOCKS 链接，方便看板联动
    for (const b of input.blockers) {
      if (!b.issueKey) continue;
      const blocker = await ctx.db.issue.findUnique({ where: { issueKey: b.issueKey } });
      if (blocker && blocker.projectId === issue.projectId && blocker.id !== issue.id) {
        await ctx.db.issueLink
          .create({
            data: {
              fromIssueId: blocker.id,
              toIssueId: issue.id,
              type: 'BLOCKS',
              createdById: ctx.actorId!,
            },
          })
          .catch(() => {});
      }
    }
  }
  return {
    issueKey,
    percent: report.percent,
    message:
      input.percent >= 100
        ? '进度已记录为 100%。请将 issue 流转到下一个状态（如 In Review / Done）'
        : '进度已记录',
  };
}
