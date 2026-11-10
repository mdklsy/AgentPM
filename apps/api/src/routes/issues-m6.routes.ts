import { z } from 'zod';
import {
  AppError,
  AddWorklogSchema,
  BulkIssueSchema,
  CreateIssueSchema,
  SearchIssuesQuerySchema,
} from '@agentpm/shared';
import {
  addWorklog,
  createIssue,
  listWorklogs,
  searchIssues,
  setFieldValues,
  assignIssue,
  requireProjectMembership,
  setIssueSprint,
  transitionIssue,
  updateIssue,
} from '@agentpm/core';
import { requireAuth } from '../plugins/auth.js';
import { makeCtx } from '../ctx.js';
import { parseCsv, toCsv } from '../utils/csv.js';
import type { FastifyApp } from '../types.js';

/** M6 issue 扩展：CSV 导出/导入、批量操作、工时、自定义字段值。 */
export function registerIssueM6Routes(app: FastifyApp) {
  /* ---------------- CSV 导出 ---------------- */
  app.get('/v1/projects/:key/issues.csv', async (req, reply) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    const ctx = makeCtx(app, req);
    const q = SearchIssuesQuerySchema.parse({
      ...(req.query as Record<string, string>),
      page: '1',
      pageSize: '100',
    });
    const fields = await ctx.db.customFieldDef.findMany({
      where: { project: { key } },
      orderBy: { sortOrder: 'asc' },
    });

    const headers = [
      'issueKey',
      'type',
      'title',
      'description',
      'priority',
      'assignee',
      'labels',
      'parent',
      'storyPoints',
      'dueDate',
      'estimateMinutes',
      'release',
      ...fields.map((f) => `field:${f.name}`),
    ];
    const rows: unknown[][] = [];
    let page = q.page;
    for (;;) {
      const { items, total } = await searchIssues(ctx, key, { ...q, page, pageSize: 100 });
      for (const it of items) {
        const detail = await app.db.issue.findUniqueOrThrow({
          where: { issueKey: it.issueKey },
          include: {
            release: { select: { name: true } },
            fieldValues: { include: { field: { select: { name: true } } } },
            assignee: { select: { name: true } },
            labels: { include: { label: { select: { name: true } } } },
            parentIssue: { select: { issueKey: true } },
          },
        });
        const fv = new Map(detail.fieldValues.map((v) => [v.field.name, v.value]));
        rows.push([
          detail.issueKey,
          detail.type,
          detail.title,
          detail.description ?? '',
          detail.priority,
          detail.assignee?.name ?? '',
          detail.labels.map((l) => l.label.name).join(';'),
          detail.parentIssue?.issueKey ?? '',
          detail.storyPoints ?? '',
          detail.dueDate ? detail.dueDate.toISOString().slice(0, 10) : '',
          detail.estimateMinutes ?? '',
          detail.release?.name ?? '',
          ...fields.map((f) => {
            const v = fv.get(f.name);
            return v === null || v === undefined
              ? ''
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v);
          }),
        ]);
      }
      if (rows.length >= total || items.length === 0) break;
      page += 1;
    }
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${key}-issues.csv"`);
    return toCsv(headers, rows);
  });

  /* ---------------- CSV 导入 ---------------- */
  app.post('/v1/projects/:key/issues/import', async (req) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const ctx = makeCtx(app, req);
    const { csv } = req.body as { csv?: string };
    if (!csv || !csv.trim()) throw AppError.badRequest('缺少 csv 文本', 'CSV_REQUIRED');
    // 整体角色预检：VIEWER 直接 403，而不是把权限错误伪装成行级失败
    await requireProjectMembership(ctx, key, 'MEMBER');

    const rows = parseCsv(csv);
    if (rows.length < 2) return { created: 0, failed: [] };
    const header = rows[0]!.map((h) => h.trim());
    const idx = (name: string) => header.indexOf(name);
    const need = ['type', 'title'];
    for (const n of need)
      if (idx(n) < 0) throw AppError.badRequest(`CSV 缺少必需列：${n}`, 'CSV_MISSING_COLUMN');

    // 版本名 → id 映射（可选列 release）
    const releases = await ctx.db.release.findMany({
      where: { project: { key } },
      select: { id: true, name: true },
    });
    const releaseByName = new Map(releases.map((r) => [r.name, r.id]));

    const failed: Array<{ row: number; error: string }> = [];
    let created = 0;
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r]!;
      const get = (name: string) => (idx(name) >= 0 ? (cells[idx(name)] ?? '').trim() : '');
      try {
        const input = CreateIssueSchema.parse({
          type: get('type').toUpperCase(),
          title: get('title'),
          ...(get('description') ? { description: get('description') } : {}),
          ...(get('priority') ? { priority: get('priority') } : {}),
          ...(get('assignee') ? { assigneeName: get('assignee') } : {}),
          ...(get('parent') ? { parentIssueKey: get('parent') } : {}),
          ...(get('labels')
            ? {
                labelNames: get('labels')
                  .split(';')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(get('storyPoints') ? { storyPoints: Number(get('storyPoints')) } : {}),
          ...(get('dueDate') ? { dueDate: get('dueDate') } : {}),
          ...(get('estimateMinutes') ? { estimateMinutes: Number(get('estimateMinutes')) } : {}),
          ...(get('release') ? { releaseId: releaseByName.get(get('release')) } : {}),
        });
        await createIssue(ctx, key, input);
        created += 1;
      } catch (e) {
        failed.push({
          row: r + 1,
          error:
            e instanceof z.ZodError
              ? e.issues.map((i) => i.message).join('；')
              : (e as Error).message,
        });
      }
    }
    return { created, failed };
  });

  /* ---------------- 批量操作 ---------------- */
  app.post('/v1/projects/:key/issues/bulk', async (req) => {
    requireAuth(req, 'write');
    const ctx = makeCtx(app, req);
    const input = BulkIssueSchema.parse(req.body);
    const results: Array<{ issueKey: string; ok: boolean; error?: string }> = [];
    for (const issueKey of input.issueKeys) {
      try {
        switch (input.action) {
          case 'transition':
            await transitionIssue(ctx, issueKey, input.toState!, undefined);
            break;
          case 'assign':
            await assignIssue(ctx, issueKey, input.assigneeName ?? null);
            break;
          case 'priority':
            await updateIssue(ctx, issueKey, { priority: input.priority! });
            break;
          case 'sprint':
            await setIssueSprint(ctx, issueKey, input.sprintId ?? null);
            break;
        }
        results.push({ issueKey, ok: true });
      } catch (e) {
        results.push({ issueKey, ok: false, error: (e as Error).message });
      }
    }
    return { results, okCount: results.filter((r) => r.ok).length };
  });

  /* ---------------- 工时 ---------------- */
  app.post('/v1/issues/:key/worklogs', async (req, reply) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const input = AddWorklogSchema.parse(req.body);
    const log = await addWorklog(makeCtx(app, req), key, input);
    return reply.status(201).send({ worklog: { id: log.id, minutes: log.minutes } });
  });

  app.get('/v1/issues/:key/worklogs', async (req) => {
    requireAuth(req);
    const { key } = req.params as { key: string };
    return { worklogs: await listWorklogs(makeCtx(app, req), key) };
  });

  /* ---------------- 自定义字段值 ---------------- */
  app.put('/v1/issues/:key/fields', async (req) => {
    requireAuth(req, 'write');
    const { key } = req.params as { key: string };
    const { values } = req.body as { values?: Record<string, unknown> };
    if (!values || typeof values !== 'object')
      throw AppError.badRequest('缺少 values 对象', 'VALUES_REQUIRED');
    await setFieldValues(makeCtx(app, req), key, values);
    return { ok: true };
  });
}
