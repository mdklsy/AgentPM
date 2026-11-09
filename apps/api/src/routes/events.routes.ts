import { requireProjectMembership } from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/**
 * SSE 实时活动流：GET /v1/projects/:key/events（EventSource，cookie 认证）。
 * 实现为每连接 2s 轮询 DB 增量推送（M3 简版）；
 * 多实例部署时换 Redis pub/sub（见 roadmap M4），客户端协议不变。
 */
export function registerEventRoutes(app: FastifyApp) {
  app.get('/v1/projects/:key/events', async (req, reply) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    await requireProjectMembership(makeCtx(app, req), key, 'VIEWER');

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ project: key })}\n\n`);

    let closed = false;
    let lastAt = new Date();
    const seen = new Set<string>();

    const tick = async () => {
      if (closed) return;
      try {
        const items = await app.db.activity.findMany({
          where: { project: { key }, createdAt: { gt: lastAt } },
          orderBy: { createdAt: 'asc' },
          take: 50,
          include: {
            actor: { select: { name: true, displayName: true, type: true } },
            issue: { select: { issueKey: true } },
          },
        });
        for (const a of items) {
          if (a.createdAt > lastAt) lastAt = a.createdAt;
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          reply.raw.write(
            `event: activity\ndata: ${JSON.stringify({
              id: a.id,
              action: a.action,
              summary: a.summary,
              source: a.source,
              actor: a.actor ? { name: a.actor.name, type: a.actor.type } : null,
              issue: a.issue?.issueKey ?? null,
              createdAt: a.createdAt,
            })}\n\n`,
          );
        }
      } catch {
        /* 瞬时 DB 错误忽略，下轮重试 */
      }
    };

    const timer = setInterval(() => void tick(), 2000);
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 15_000);
    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    };
    req.raw.on('close', stop);
    setTimeout(stop, 10 * 60_000); // 10 分钟后主动断开，EventSource 会自动重连
  });
}
