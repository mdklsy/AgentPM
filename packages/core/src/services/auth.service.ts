import { hash, verify } from '@node-rs/argon2';
import { AppError } from '@agentpm/shared';
import { generateApiToken, hashApiToken, tokenDisplayPrefix } from '@agentpm/shared/node';
import type { PrismaClient } from '@agentpm/db';
import type { CreateTokenInput, LoginInput, RegisterInput } from '@agentpm/shared';
import type { Ctx } from '../ctx.js';

const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

/** 注册：第一个人类用户自动成为实例管理员。 */
export async function register(db: PrismaClient, input: RegisterInput) {
  const exists = await db.actor.findUnique({ where: { name: input.username } });
  if (exists) throw AppError.conflict(`用户名已被占用：${input.username}`, 'USERNAME_TAKEN');

  const humanCount = await db.actor.count({ where: { type: 'HUMAN' } });
  const isFirst = humanCount === 0;
  if (!isFirst) {
    // 开放注册仅允许在已有实例上创建普通用户；如需封闭注册，由部署方在网关层限制
  }

  return db.actor.create({
    data: {
      type: 'HUMAN',
      name: input.username,
      displayName: input.displayName ?? input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      isAdmin: isFirst,
    },
  });
}

export async function login(db: PrismaClient, input: LoginInput) {
  const actor = await db.actor.findUnique({ where: { name: input.username } });
  if (!actor || !actor.passwordHash || actor.type !== 'HUMAN') {
    throw AppError.unauthorized('用户名或密码错误', 'BAD_CREDENTIALS');
  }
  if (!actor.isActive) throw AppError.forbidden('账号已被停用', 'ACTOR_INACTIVE');
  const ok = await verify(actor.passwordHash, input.password);
  if (!ok) throw AppError.unauthorized('用户名或密码错误', 'BAD_CREDENTIALS');
  return actor;
}

/** 校验 Bearer token（REST 与 MCP 共用）。返回 actor + token 记录。 */
export async function authenticateToken(db: PrismaClient, rawToken: string) {
  const tokenHash = hashApiToken(rawToken);
  const token = await db.apiToken.findUnique({
    where: { tokenHash },
    include: { actor: true },
  });
  if (!token) throw AppError.unauthorized('无效的 API token', 'BAD_TOKEN');
  if (token.revokedAt) throw AppError.unauthorized('token 已吊销', 'TOKEN_REVOKED');
  if (token.expiresAt && token.expiresAt < new Date())
    throw AppError.unauthorized('token 已过期', 'TOKEN_EXPIRED');
  if (!token.actor.isActive) throw AppError.forbidden('账号已被停用', 'ACTOR_INACTIVE');

  void db.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { actor: token.actor, token };
}

export function tokenScopes(token: { scopes: unknown }): string[] {
  return Array.isArray(token.scopes) ? (token.scopes as string[]) : [];
}

/**
 * 签发 token，明文仅此一次返回。
 * 注：token 操作是实例级（无项目上下文），不落项目 Activity 流；
 * 签发/吊销留痕由 Notification 体系在 M4 覆盖。
 */
export async function createToken(ctx: Ctx, actorId: string, input: CreateTokenInput) {
  const raw = generateApiToken();
  const record = await ctx.db.apiToken.create({
    data: {
      actorId,
      name: input.name,
      prefix: tokenDisplayPrefix(raw),
      tokenHash: hashApiToken(raw),
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    },
  });
  return { token: record, plaintext: raw };
}

export async function listTokens(ctx: Ctx, actorId: string) {
  return ctx.db.apiToken.findMany({
    where: { actorId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

export async function revokeToken(ctx: Ctx, actorId: string, tokenId: string) {
  const token = await ctx.db.apiToken.findFirst({ where: { id: tokenId, actorId } });
  if (!token || token.revokedAt) throw AppError.notFound('token 不存在', 'TOKEN_NOT_FOUND');
  await ctx.db.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  return { ok: true };
}
