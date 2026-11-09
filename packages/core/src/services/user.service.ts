import { AppError, type AdminUpdateUserInput, type CreateUserInput } from '@agentpm/shared';
import type { Actor, Prisma } from '@agentpm/db';
import type { Ctx } from '../ctx.js';
import { hashPassword } from './auth.service.js';

/**
 * 实例级团队管理（M5.5）：独立于项目的全局花名册。
 * 实例级操作与 token/改密一致，不落项目 Activity 审计。
 */

/** 实例管理员守卫（isAdmin 在 Actor 上，Ctx 不携带，现查一次）。 */
export async function requireInstanceAdmin(ctx: Ctx): Promise<Actor> {
  if (!ctx.actorId) throw AppError.unauthorized();
  const actor = await ctx.db.actor.findUnique({ where: { id: ctx.actorId } });
  if (!actor?.isAdmin) throw AppError.forbidden('仅实例管理员可执行此操作', 'NOT_INSTANCE_ADMIN');
  return actor;
}

const PUBLIC_FIELDS = { name: true, displayName: true, type: true, avatarUrl: true } as const;

export async function listUsers(
  ctx: Ctx,
  opts: { q?: string; type?: 'HUMAN' | 'AGENT' | 'AVATAR' } = {},
) {
  const admin = ctx.actorId ? await ctx.db.actor.findUnique({ where: { id: ctx.actorId } }) : null;
  const isAdmin = admin?.isAdmin ?? false;
  const where: Prisma.ActorWhereInput = {
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.q
      ? {
          OR: [{ name: { contains: opts.q } }, { displayName: { contains: opts.q } }],
        }
      : {}),
  };
  const users = await ctx.db.actor.findMany({
    where,
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    // 管理员可见完整资料；普通登录用户只见花名册公开字段（不含邮箱）
    select: isAdmin
      ? {
          ...PUBLIC_FIELDS,
          id: true,
          email: true,
          isAdmin: true,
          isActive: true,
          mustChangePassword: true,
          passwordHash: true,
          createdAt: true,
        }
      : PUBLIC_FIELDS,
  });
  return users.map((u) => {
    if (!('passwordHash' in u)) return u;
    const { passwordHash, ...rest } = u;
    return { ...rest, hasPassword: Boolean(passwordHash) }; // hasPassword 非存储列
  });
}

/** 管理员创建 HUMAN 用户（密码仅哈希落库）。 */
export async function createUser(ctx: Ctx, input: CreateUserInput) {
  await requireInstanceAdmin(ctx);
  const exists = await ctx.db.actor.findUnique({ where: { name: input.name } });
  if (exists) throw AppError.conflict(`账号 ${input.name} 已存在`, 'ACTOR_EXISTS');
  const user = await ctx.db.actor.create({
    data: {
      type: 'HUMAN',
      name: input.name,
      displayName: input.displayName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      isAdmin: input.isAdmin,
      mustChangePassword: input.mustChangePassword,
    },
  });
  return stripSecrets(user, true);
}

/** 管理员更新用户（重置密码/启停/管理员开关）；守卫防止把实例锁死。 */
export async function adminUpdateUser(ctx: Ctx, name: string, input: AdminUpdateUserInput) {
  await requireInstanceAdmin(ctx);
  const target = await ctx.db.actor.findUnique({ where: { name } });
  if (!target || target.type !== 'HUMAN')
    throw AppError.notFound(`用户 ${name} 不存在`, 'USER_NOT_FOUND');

  const removingAdmin = input.isAdmin === false && target.isAdmin;
  const deactivating = input.isActive === false && target.isActive;
  if ((removingAdmin || deactivating) && target.id === ctx.actorId)
    throw AppError.badRequest('不能停用或降级自己', 'SELF_LOCKOUT');

  if (removingAdmin || deactivating) {
    const otherActiveAdmins = await ctx.db.actor.count({
      where: { isAdmin: true, isActive: true, id: { not: target.id } },
    });
    if (otherActiveAdmins === 0)
      throw AppError.badRequest('至少要保留一个启用的实例管理员', 'LAST_ADMIN');
  }

  const user = await ctx.db.actor.update({
    where: { id: target.id },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      // 管理员重置密码：强制首次登录改密
      ...(input.newPassword
        ? { passwordHash: await hashPassword(input.newPassword), mustChangePassword: true }
        : {}),
    },
  });
  return stripSecrets(user, true);
}

/** 本人改显示名。 */
export async function updateSelfProfile(ctx: Ctx, name: string, input: { displayName?: string }) {
  if (!ctx.actorId || ctx.actorName !== name) throw AppError.forbidden('只能修改自己的资料');
  const user = await ctx.db.actor.update({
    where: { name },
    data: { ...(input.displayName !== undefined ? { displayName: input.displayName } : {}) },
  });
  return stripSecrets(user, false);
}

/** 本人或管理员更新头像（data URL；清空传 null）。 */
export async function setAvatar(ctx: Ctx, name: string, avatarUrl: string | null): Promise<void> {
  const target = await ctx.db.actor.findUnique({ where: { name } });
  if (!target) throw AppError.notFound(`用户 ${name} 不存在`, 'USER_NOT_FOUND');
  if (target.id !== ctx.actorId) await requireInstanceAdmin(ctx);
  await ctx.db.actor.update({ where: { id: target.id }, data: { avatarUrl } });
}

/** 选人搜索（登录即可用，脱敏：不含邮箱）。 */
export async function searchActors(ctx: Ctx, q: string, limit = 20) {
  const actors = await ctx.db.actor.findMany({
    where: {
      isActive: true,
      ...(q ? { OR: [{ name: { contains: q } }, { displayName: { contains: q } }] } : {}),
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    take: Math.min(limit, 50),
    select: { ...PUBLIC_FIELDS, id: true },
  });
  return actors;
}

/** 落库行 → 对外视图：绝不带出 passwordHash；管理员视图附 hasPassword。 */
function stripSecrets(user: Actor, adminView: boolean) {
  const { passwordHash, ...rest } = user;
  return adminView ? { ...rest, hasPassword: Boolean(passwordHash) } : rest;
}
