import type { Prisma } from '@agentpm/db';
import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { notificationMail, queueMail } from './mailer.js';

/**
 * 站内通知（M4）：领域事件 → 相关人的收件箱。
 * 规则：绝不通知触发者本人；通知是"事后的、尽力而为的"，失败不阻断主流程。
 * M6 起：落库后对有 email 的 HUMAN 收件人追加邮件外发（sender 由宿主注入，未配置则跳过）。
 */

export type NotificationType =
  | 'issue.assigned' // 你被指派了任务
  | 'issue.completed' // 你报告/关注的 issue 已完成
  | 'comment.added' // 你负责/报告/关注的 issue 有新评论
  | 'comment.mentioned' //（M6）评论里 @ 到了你
  | 'approval.requested' //（管理员）有 agent 动作待审批
  | 'approval.decided' //（发起者）你的审批请求有结果
  | 'report.published' //（管理员/负责人）替身发布了日报或风险告警
  | 'webhook.ping'; // 测试投递

/** 各通知类型的站内标题（邮件标题同源）。 */
const TYPE_TITLE: Record<NotificationType, string> = {
  'issue.assigned': '你被指派了任务',
  'issue.completed': '你关注的 issue 已完成',
  'comment.added': '你关注的 issue 有新评论',
  'comment.mentioned': '有人在评论里 @ 了你',
  'approval.requested': '有 agent 动作待你审批',
  'approval.decided': '你的审批请求有结果',
  'report.published': '替身发布了新报告',
  'webhook.ping': 'Webhook 测试投递',
};

export async function notify(
  ctx: Ctx,
  recipients: Array<string | undefined | null>,
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<void> {
  const uniq = [...new Set(recipients.filter((r): r is string => !!r && r !== ctx.actorId))];
  if (!uniq.length) return;
  await ctx.db.notification
    .createMany({
      data: uniq.map((recipientId) => ({
        recipientId,
        type,
        payload: payload as Prisma.InputJsonValue,
      })),
    })
    .catch(() => {}); // 通知失败不影响主流程

  // 邮件外发（尽力而为）：仅 HUMAN + 有 email 的收件人；未配 SMTP 则静默跳过
  if (!ctx.appUrl) return;
  const actors = await ctx.db.actor.findMany({
    where: { id: { in: uniq }, type: 'HUMAN', isActive: true, email: { not: null } },
    select: { id: true, email: true },
  });
  const projectKey = typeof payload.projectKey === 'string' ? payload.projectKey : null;
  const issueKey = typeof payload.issueKey === 'string' ? payload.issueKey : null;
  const title = TYPE_TITLE[type] ?? type;
  for (const a of actors) {
    queueMail(
      notificationMail({
        to: a.email!,
        title,
        body: `${typeof payload.title === 'string' ? payload.title + '\n' : ''}${
          issueKey ? `Issue: ${issueKey}` : ''
        }`,
        url: projectKey
          ? `${ctx.appUrl}/p/${projectKey}${issueKey ? `?issue=${issueKey}` : ''}`
          : ctx.appUrl,
      }),
    );
  }
}

/** issue 相关事件的常用收件人：指派人 + 报告人 + 关注者（不含触发者）。 */
export async function issueAudience(
  ctx: Ctx,
  issue: { id: string; assigneeId: string | null; reporterId: string; projectId: string },
): Promise<string[]> {
  const watchers = await ctx.db.watcher.findMany({
    where: { issueId: issue.id },
    select: { actorId: true },
  });
  return [
    ...new Set([issue.assigneeId, issue.reporterId, ...watchers.map((w) => w.actorId)]),
  ].filter((x): x is string => !!x);
}

/** 项目的 ADMIN/OWNER（审批请求通知给他们）。 */
export async function projectAdmins(ctx: Ctx, projectId: string): Promise<string[]> {
  const members = await ctx.db.member.findMany({
    where: { projectId, role: { in: ['ADMIN', 'OWNER'] } },
    select: { actorId: true, actor: { select: { type: true, isActive: true } } },
  });
  return members.filter((m) => m.actor.isActive).map((m) => m.actorId);
}

/* ---------------- 查询侧（REST） ---------------- */

export const NotificationQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listNotifications(ctx: Ctx, unreadOnly: boolean, limit: number) {
  const where = { recipientId: ctx.actorId!, ...(unreadOnly ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([
    ctx.db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    ctx.db.notification.count({ where: { recipientId: ctx.actorId!, readAt: null } }),
  ]);
  return {
    unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  };
}

export async function markRead(ctx: Ctx, id?: string) {
  await ctx.db.notification.updateMany({
    where: { recipientId: ctx.actorId!, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
