import { z } from 'zod';
import {
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  pingWebhook,
  toggleWebhook,
  WEBHOOK_EVENTS,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/** 出站 webhook 管理（项目 ADMIN）。事件清单也供前端渲染订阅项。 */
export function registerWebhookRoutes(app: FastifyApp) {
  app.get('/v1/webhook-events', async () => ({ events: WEBHOOK_EVENTS.filter((e) => e !== '*') }));

  app.get('/v1/projects/:key/webhooks', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { webhooks: await listWebhooks(makeCtx(app, req), key) };
  });

  app.post('/v1/projects/:key/webhooks', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = z
      .object({
        url: z.string().url(),
        events: z.array(z.string()).min(1).default(['*']),
        secret: z.string().min(16).max(128).optional(),
      })
      .parse(req.body);
    const hook = await createWebhook(makeCtx(app, req), key, input);
    return reply
      .status(201)
      .send({ webhook: { id: hook.id, url: hook.url, events: hook.events }, secret: hook.secret });
  });

  app.patch('/v1/projects/:key/webhooks/:id', async (req) => {
    requireAuth(req, 'write');
    const { key, id } = req.params as { key: string; id: string };
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    return toggleWebhook(makeCtx(app, req), key, id, isActive);
  });

  app.delete('/v1/projects/:key/webhooks/:id', async (req) => {
    requireAuth(req, 'write');
    const { key, id } = req.params as { key: string; id: string };
    return deleteWebhook(makeCtx(app, req), key, id);
  });

  app.get('/v1/projects/:key/webhooks/:id/deliveries', async (req) => {
    requireAuth(req);
    const { key, id } = req.params as { key: string; id: string };
    return { deliveries: await listDeliveries(makeCtx(app, req), key, id) };
  });

  app.post('/v1/projects/:key/webhooks/:id/ping', async (req) => {
    requireAuth(req, 'write');
    const { key, id } = req.params as { key: string; id: string };
    return pingWebhook(makeCtx(app, req), key, id);
  });
}
