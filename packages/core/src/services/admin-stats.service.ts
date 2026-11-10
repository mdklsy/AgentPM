import type { Ctx } from '../ctx.js';
import { requireInstanceAdmin } from './user.service.js';

/** 实例管理统计（M6，仅实例管理员）：计数 + 存储占用 + 邮件配置状态。 */
export async function instanceStats(ctx: Ctx) {
  await requireInstanceAdmin(ctx);
  const [users, projects, issues, tokens, attachments, activity7d] = await Promise.all([
    ctx.db.actor.count(),
    ctx.db.project.count({ where: { archivedAt: null } }),
    ctx.db.issue.count(),
    ctx.db.apiToken.count({ where: { revokedAt: null } }),
    ctx.db.attachment.aggregate({ _count: { id: true }, _sum: { sizeBytes: true } }),
    ctx.db.activity.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);
  return {
    users,
    activeProjects: projects,
    issues,
    activeTokens: tokens,
    attachments: { count: attachments._count.id, totalBytes: attachments._sum.sizeBytes ?? 0 },
    activity7d,
  };
}
