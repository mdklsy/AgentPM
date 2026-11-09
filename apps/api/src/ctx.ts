import type { FastifyRequest } from 'fastify';
import type { ActivitySource } from '@agentpm/shared';
import type { Ctx } from '@agentpm/core';
import type { FastifyApp } from './types.js';

/** 从请求构造服务层 Ctx（审计来源自动判定；MCP 端点自行传 source='MCP'）。 */
export function makeCtx(app: FastifyApp, req: FastifyRequest, overrides: Partial<Ctx> = {}): Ctx {
  return {
    db: app.db,
    actorId: req.actor?.id,
    actorType: req.actor?.type,
    actorName: req.actor?.name,
    apiTokenId: req.apiTokenId,
    source: (req.authKind === 'API' ? 'API' : 'WEB') as ActivitySource,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? undefined,
    ...overrides,
  };
}
