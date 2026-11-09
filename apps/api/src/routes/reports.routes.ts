import { CreateReportSchema } from '@agentpm/shared';
import { createReport, listReports } from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/** 替身报告（M5）：发布走 MEMBER（替身以 AGENT 角色加入项目）；列表 VIEWER 可读。 */
export function registerReportRoutes(app: FastifyApp) {
  app.get('/v1/projects/:key/reports', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const q = req.query as { limit?: string };
    return { reports: await listReports(makeCtx(app, req), key, q.limit ? Number(q.limit) : 20) };
  });

  app.post('/v1/projects/:key/reports', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = CreateReportSchema.parse(req.body);
    const report = await createReport(makeCtx(app, req), key, input);
    return reply.status(201).send({
      report: {
        id: report.id,
        kind: report.kind,
        title: report.title,
        createdAt: report.createdAt,
      },
    });
  });
}
