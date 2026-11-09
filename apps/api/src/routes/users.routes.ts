import {
  AppError,
  AdminUpdateUserSchema,
  AvatarDataSchema,
  CreateUserSchema,
  SelfUpdateSchema,
} from '@agentpm/shared';
import {
  adminUpdateUser,
  createUser,
  listUsers,
  searchActors,
  setAvatar,
  updateSelfProfile,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/**
 * 实例级团队管理（M5.5）：全局花名册独立于项目。
 * 实例管理员：列全量/建用户/重置密码/启停/管理员开关；本人：改显示名、传头像；
 * 选人搜索对全部登录用户开放（脱敏）。
 */
export function registerUserRoutes(app: FastifyApp) {
  app.get('/v1/users', async (req) => {
    requireAuth(req);
    const q = req.query as { q?: string; type?: 'HUMAN' | 'AGENT' | 'AVATAR' };
    return { users: await listUsers(makeCtx(app, req), { q: q.q, type: q.type }) };
  });

  app.post('/v1/users', async (req, reply) => {
    requireAuth(req, 'write');
    const input = CreateUserSchema.parse(req.body);
    const user = await createUser(makeCtx(app, req), input);
    return reply.status(201).send({ user });
  });

  app.patch('/v1/users/:name', async (req) => {
    const actor = requireAuth(req, 'write');
    const { name } = req.params as { name: string };
    const ctx = makeCtx(app, req);
    if (actor.isAdmin) {
      // 管理员全字段（服务层守卫：不能停用/降级自己、保留最后一个管理员）
      return { user: await adminUpdateUser(ctx, name, AdminUpdateUserSchema.parse(req.body)) };
    }
    if (actor.name !== name) throw AppError.forbidden('只能修改自己的资料', 'NOT_SELF');
    return { user: await updateSelfProfile(ctx, name, SelfUpdateSchema.parse(req.body)) };
  });

  app.post('/v1/users/:name/avatar', async (req) => {
    const actor = requireAuth(req, 'write');
    const { name } = req.params as { name: string };
    if (actor.name !== name && !actor.isAdmin)
      throw AppError.forbidden('只能修改自己的头像', 'NOT_SELF');
    const { dataUrl } = req.body as { dataUrl?: unknown };
    const avatarUrl = dataUrl === null ? null : AvatarDataSchema.parse(dataUrl);
    await setAvatar(makeCtx(app, req), name, avatarUrl);
    return { ok: true, avatarUrl };
  });

  app.get('/v1/actors/search', async (req) => {
    requireAuth(req);
    const q = req.query as { q?: string; limit?: string };
    return {
      actors: await searchActors(makeCtx(app, req), q.q ?? '', q.limit ? Number(q.limit) : 20),
    };
  });
}
