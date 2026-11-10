import { z } from 'zod';
import { SearchIssuesQuerySchema } from '@agentpm/shared';
import {
  agileReport,
  createField,
  createFilter,
  createRelease,
  deleteField,
  deleteFilter,
  deleteRelease,
  instanceStats,
  listFields,
  listFilters,
  listReleases,
  myWork,
  requireInstanceAdmin,
  updateField,
  updateRelease,
  getWorkflow,
  replaceWorkflow,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import type { FastifyApp } from '../types.js';

/** M6 项目扩展路由：自定义字段 / 版本 / 过滤器 / 敏捷报表；实例级：我的工作、管理统计。 */
export function registerM6Routes(app: FastifyApp) {
  /* ---------------- 自定义字段 ---------------- */
  app.get('/v1/projects/:key/fields', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { fields: await listFields(makeCtx(app, req), key) };
  });

  app.post('/v1/projects/:key/fields', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = z
      .object({
        name: z.string().min(1).max(64),
        type: z.enum(['text', 'number', 'date', 'select']),
        options: z.array(z.string().max(128)).max(50).optional(),
        appliesTo: z.array(z.string().max(16)).max(8).optional(),
      })
      .parse(req.body);
    const field = await createField(makeCtx(app, req), key, input);
    return reply.status(201).send({ field: { id: field.id, name: field.name, type: field.type } });
  });

  app.patch('/v1/projects/:key/fields/:fieldId', async (req) => {
    requireAuth(req, 'write');
    const { key, fieldId } = req.params as { key: string; fieldId: string };
    const input = z
      .object({
        name: z.string().min(1).max(64).optional(),
        options: z.array(z.string().max(128)).max(50).optional(),
        appliesTo: z.array(z.string().max(16)).max(8).optional(),
      })
      .parse(req.body);
    const field = await updateField(makeCtx(app, req), key, fieldId, input);
    return { field: { id: field.id, name: field.name } };
  });

  app.delete('/v1/projects/:key/fields/:fieldId', async (req) => {
    requireAuth(req, 'write');
    const { key, fieldId } = req.params as { key: string; fieldId: string };
    return deleteField(makeCtx(app, req), key, fieldId);
  });

  /* ---------------- 版本 Release ---------------- */
  app.get('/v1/projects/:key/releases', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { releases: await listReleases(makeCtx(app, req), key) };
  });

  app.post('/v1/projects/:key/releases', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = z
      .object({
        name: z.string().min(1).max(128),
        releaseDate: z.string().optional().nullable(),
        description: z.string().max(2000).optional().nullable(),
      })
      .parse(req.body);
    const release = await createRelease(makeCtx(app, req), key, input);
    return reply.status(201).send({ release: { id: release.id, name: release.name } });
  });

  app.patch('/v1/projects/:key/releases/:releaseId', async (req) => {
    requireAuth(req, 'write');
    const { key, releaseId } = req.params as { key: string; releaseId: string };
    const input = z
      .object({
        name: z.string().min(1).max(128).optional(),
        status: z.enum(['planned', 'released', 'archived']).optional(),
        releaseDate: z.string().optional().nullable(),
        description: z.string().max(2000).optional().nullable(),
      })
      .parse(req.body);
    const release = await updateRelease(makeCtx(app, req), key, releaseId, input);
    return { release: { id: release.id, status: release.status } };
  });

  app.delete('/v1/projects/:key/releases/:releaseId', async (req) => {
    requireAuth(req, 'write');
    const { key, releaseId } = req.params as { key: string; releaseId: string };
    return deleteRelease(makeCtx(app, req), key, releaseId);
  });

  /* ---------------- 保存的过滤器 ---------------- */
  app.get('/v1/projects/:key/filters', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { filters: await listFilters(makeCtx(app, req), key) };
  });

  app.post('/v1/projects/:key/filters', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = z
      .object({
        name: z.string().min(1).max(64),
        query: SearchIssuesQuerySchema.partial(),
        shared: z.boolean().default(false),
      })
      .parse(req.body);
    const filter = await createFilter(makeCtx(app, req), key, input);
    return reply.status(201).send({ filter: { id: filter.id, name: filter.name } });
  });

  app.delete('/v1/projects/:key/filters/:filterId', async (req) => {
    requireAuth(req, 'write');
    const { key, filterId } = req.params as { key: string; filterId: string };
    return deleteFilter(makeCtx(app, req), key, filterId);
  });

  /* ---------------- 工作流编辑 ---------------- */
  app.get('/v1/projects/:key/workflows/:issueType', async (req) => {
    requireAuth(req);
    const { key, issueType } = req.params as { key: string; issueType: string };
    return getWorkflow(makeCtx(app, req), key, issueType);
  });

  app.put('/v1/projects/:key/workflows/:issueType', async (req) => {
    requireAuth(req, 'write');
    const { key, issueType } = req.params as { key: string; issueType: string };
    const input = z
      .object({
        name: z.string().min(1).max(64).optional(),
        states: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().min(1).max(64),
              category: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
              isInitial: z.boolean().optional(),
            }),
          )
          .min(2)
          .max(20),
        transitions: z.array(z.tuple([z.string().max(64).nullable(), z.string().max(64)])).max(200),
      })
      .parse(req.body);
    const wf = await replaceWorkflow(makeCtx(app, req), key, issueType, input);
    return { workflow: wf };
  });

  /* ---------------- 敏捷报表 ---------------- */
  app.get('/v1/projects/:key/reports/agile', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return agileReport(makeCtx(app, req), key);
  });

  /* ---------------- 我的工作（跨项目） ---------------- */
  app.get('/v1/my/work', async (req) => {
    requireAuth(req);
    return myWork(makeCtx(app, req));
  });

  /* ---------------- 实例管理统计 ---------------- */
  app.get('/v1/admin/stats', async (req) => {
    requireAuth(req);
    await requireInstanceAdmin(makeCtx(app, req));
    const stats = await instanceStats(makeCtx(app, req));
    return { ...stats, mailConfigured: app.config.smtp.host ? true : false };
  });
}
