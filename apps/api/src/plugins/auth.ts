import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '@agentpm/db';
import { AppError, type Scope } from '@agentpm/shared';
import { authenticateToken, tokenScopes } from '@agentpm/core';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
    apiTokenId?: string;
    scopes?: string[];
    /** token 认证 = 'API'，cookie 会话 = 'WEB'（供审计来源判定） */
    authKind?: 'API' | 'WEB';
  }
}

export const SESSION_COOKIE = 'agentpm_session';

/**
 * 认证解析（onRequest，对全部路由生效，匿名也可通过——由各路由决定是否必须登录）：
 * 1. Authorization: Bearer apm_xxx → ApiToken 认证（REST 与 MCP 共用）
 * 2. cookie agentpm_session（JWT）→ Web 会话
 */
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('actor', undefined);
  app.decorateRequest('apiTokenId', undefined);
  app.decorateRequest('scopes', undefined);
  app.decorateRequest('authKind', undefined);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const raw = header.slice(7).trim();
      if (raw.startsWith('apm_')) {
        const { actor, token } = await authenticateToken(app.db, raw);
        req.actor = actor;
        req.apiTokenId = token.id;
        req.scopes = tokenScopes(token);
        req.authKind = 'API';
        return;
      }
      try {
        const payload = app.jwt.verify<{ sub: string }>(raw);
        const actor = await app.db.actor.findUnique({ where: { id: payload.sub } });
        if (actor?.isActive) {
          req.actor = actor;
          req.authKind = 'WEB';
        }
      } catch {
        /* 无效 JWT → 匿名 */
      }
      return;
    }
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie) {
      try {
        const payload = app.jwt.verify<{ sub: string }>(cookie);
        const actor = await app.db.actor.findUnique({ where: { id: payload.sub } });
        if (actor?.isActive) {
          req.actor = actor;
          req.authKind = 'WEB';
        }
      } catch {
        /* 过期/伪造 cookie → 匿名 */
      }
    }
  });
}

/** 要求已认证；token 认证时校验 scope（WEB 会话默认放行）。 */
export function requireAuth(req: FastifyRequest, scope: Scope = 'read'): Actor {
  if (!req.actor) throw AppError.unauthorized();
  if (req.authKind === 'API') {
    const scopes = req.scopes ?? [];
    if (!scopes.includes(scope) && !scopes.includes('admin')) {
      throw AppError.forbidden(`token 缺少 ${scope} 权限`, 'SCOPE_MISSING');
    }
  }
  return req.actor;
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
