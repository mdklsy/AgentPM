import { z } from 'zod';
import { verify } from '@node-rs/argon2';
import { AppError, LoginSchema, RegisterSchema } from '@agentpm/shared';
import { hashPassword, login, register } from '@agentpm/core';
import { requireAuth, SESSION_COOKIE } from '../plugins/auth.js';
import type { FastifyApp } from '../types.js';

export function registerAuthRoutes(app: FastifyApp) {
  app.post('/v1/auth/register', async (req, reply) => {
    const input = RegisterSchema.parse(req.body);
    const actor = await register(app.db, input);
    return reply.status(201).send({
      actor: {
        name: actor.name,
        displayName: actor.displayName,
        isAdmin: actor.isAdmin,
        type: actor.type,
      },
    });
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const input = LoginSchema.parse(req.body);
    const actor = await login(app.db, input);
    const token = app.jwt.sign({ sub: actor.id, name: actor.name });
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 86400,
    });
    return {
      actor: {
        name: actor.name,
        displayName: actor.displayName,
        isAdmin: actor.isAdmin,
        type: actor.type,
        mustChangePassword: actor.mustChangePassword,
      },
    };
  });

  app.post('/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/v1/auth/me', async (req) => {
    const actor = requireAuth(req);
    return {
      actor: {
        name: actor.name,
        displayName: actor.displayName,
        type: actor.type,
        isAdmin: actor.isAdmin,
        mustChangePassword: actor.mustChangePassword,
      },
    };
  });

  app.post('/v1/auth/change-password', async (req) => {
    const actor = requireAuth(req, 'write');
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string(), newPassword: z.string() })
      .parse(req.body);
    const dbActor = await app.db.actor.findUniqueOrThrow({ where: { id: actor.id } });
    const ok = await verify(dbActor.passwordHash ?? '', currentPassword);
    if (!ok) throw AppError.unauthorized('当前密码不正确', 'BAD_CREDENTIALS');
    // 密码变更属实例级操作，不落项目审计
    await app.db.actor.update({
      where: { id: actor.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    return { ok: true };
  });
}
