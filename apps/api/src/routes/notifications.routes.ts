import { listNotifications, markRead, NotificationQuerySchema } from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

export function registerNotificationRoutes(app: FastifyApp) {
  app.get('/v1/notifications', async (req) => {
    requireAuth(req);
    const q = NotificationQuerySchema.parse(req.query ?? {});
    return listNotifications(makeCtx(app, req), q.unreadOnly, q.limit);
  });

  app.post('/v1/notifications/read-all', async (req) => {
    requireAuth(req, 'write');
    return markRead(makeCtx(app, req));
  });

  app.post('/v1/notifications/:id/read', async (req) => {
    requireAuth(req, 'write');
    const { id } = req.params as { id: string };
    return markRead(makeCtx(app, req), id);
  });
}
