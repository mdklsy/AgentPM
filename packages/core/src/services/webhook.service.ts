import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, Webhook } from '@agentpm/db';
import { AppError } from '@agentpm/shared';
import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { requireProjectMembership } from './project.service.js';

/**
 * 出站 webhook（M4）：项目事件 → HMAC-SHA256 签名 POST。
 * 投递是 fire-and-forget：不阻断领域事务；每次投递落 WebhookDelivery 供排障。
 */

export const WEBHOOK_EVENTS = [
  '*',
  'issue.created',
  'issue.transitioned',
  'issue.assigned',
  'task.claimed',
  'task.released',
  'comment.added',
  'progress.reported',
  'bug.reported',
  'bug.deduplicated',
  'regression.submitted',
  'approval.requested',
  'approval.decided',
  'sprint.status_changed',
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

const CreateWebhookSchema = z.object({
  url: z.string().url().max(1024),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).default(['*']),
  secret: z.string().min(16).max(128).optional(),
});

export function signPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: string, header: string): boolean {
  const expected = Buffer.from(signPayload(secret, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** 领域事件发射口：各服务在写完审计后调用。失败静默（投递日志负责可观测）。 */
export function emitWebhook(
  ctx: Ctx,
  event: Exclude<WebhookEventName, '*'>,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify({
    event,
    projectKey: payload.projectKey ?? null,
    actor: ctx.actorName ?? null,
    actorType: ctx.actorType ?? null,
    source: ctx.source,
    occurredAt: new Date().toISOString(),
    data: payload,
  });
  void dispatch(ctx.db, event, body).catch(() => {});
}

async function dispatch(db: Ctx['db'], event: string, body: string): Promise<void> {
  const hooks = await db.webhook.findMany({
    where: {
      isActive: true,
      OR: [{ events: { array_contains: '*' } }, { events: { array_contains: event } }],
    },
  });
  await Promise.allSettled(hooks.map((h) => deliver(db, h, event, body)));
}

async function deliver(db: Ctx['db'], hook: Webhook, event: string, body: string): Promise<void> {
  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AgentPM-Webhook/0.1',
        'x-agentpm-event': event,
        'x-agentpm-signature': signPayload(hook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 500);
  }
  await db.webhookDelivery
    .create({
      data: {
        webhookId: hook.id,
        event,
        payload: body as unknown as Prisma.InputJsonValue,
        ok,
        statusCode,
        error,
        durationMs: Date.now() - started,
      },
    })
    .catch(() => {});
}

/* ---------------- CRUD（REST） ---------------- */

export async function listWebhooks(ctx: Ctx, projectKey: string) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const hooks = await ctx.db.webhook.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return hooks.map((h) => ({
    id: h.id,
    url: h.url,
    events: h.events,
    isActive: h.isActive,
    secretMasked: h.secret.slice(0, 4) + '…' + h.secret.slice(-2),
    lastDelivery: h.deliveries[0]
      ? {
          ok: h.deliveries[0].ok,
          statusCode: h.deliveries[0].statusCode,
          createdAt: h.deliveries[0].createdAt,
        }
      : null,
    createdAt: h.createdAt,
  }));
}

export async function createWebhook(ctx: Ctx, projectKey: string, raw: unknown) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const input = CreateWebhookSchema.parse(raw);
  if (!ctx.actorId) throw AppError.unauthorized();
  const secret = input.secret ?? 'whsec_' + randomBytes(24).toString('base64url');
  const hook = await ctx.db.webhook.create({
    data: {
      projectId: project.id,
      url: input.url,
      secret,
      events: input.events,
      createdById: ctx.actorId,
    },
  });
  return { id: hook.id, url: hook.url, events: hook.events, secret };
}

export async function toggleWebhook(ctx: Ctx, projectKey: string, id: string, isActive: boolean) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const hook = await ctx.db.webhook.findFirst({ where: { id, projectId: project.id } });
  if (!hook) throw AppError.notFound('webhook 不存在', 'WEBHOOK_NOT_FOUND');
  await ctx.db.webhook.update({ where: { id }, data: { isActive } });
  return { ok: true };
}

export async function deleteWebhook(ctx: Ctx, projectKey: string, id: string) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const hook = await ctx.db.webhook.findFirst({ where: { id, projectId: project.id } });
  if (!hook) throw AppError.notFound('webhook 不存在', 'WEBHOOK_NOT_FOUND');
  await ctx.db.webhook.delete({ where: { id } });
  return { ok: true };
}

export async function listDeliveries(ctx: Ctx, projectKey: string, id: string) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const hook = await ctx.db.webhook.findFirst({ where: { id, projectId: project.id } });
  if (!hook) throw AppError.notFound('webhook 不存在', 'WEBHOOK_NOT_FOUND');
  const deliveries = await ctx.db.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return deliveries.map((d) => ({
    id: d.id,
    event: d.event,
    ok: d.ok,
    statusCode: d.statusCode,
    error: d.error,
    durationMs: d.durationMs,
    createdAt: d.createdAt,
  }));
}

/** 发一条测试事件（webhook.ping），验证 URL/签名联通性。 */
export async function pingWebhook(ctx: Ctx, projectKey: string, id: string) {
  const { project } = await requireProjectMembership(ctx, projectKey, 'ADMIN');
  const hook = await ctx.db.webhook.findFirst({ where: { id, projectId: project.id } });
  if (!hook) throw AppError.notFound('webhook 不存在', 'WEBHOOK_NOT_FOUND');
  const body = JSON.stringify({
    event: 'webhook.ping',
    projectKey,
    actor: ctx.actorName ?? null,
    actorType: ctx.actorType ?? null,
    source: ctx.source,
    occurredAt: new Date().toISOString(),
    data: { message: 'AgentPM webhook 连通性测试' },
  });
  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AgentPM-Webhook/0.1',
        'x-agentpm-event': 'webhook.ping',
        'x-agentpm-signature': signPayload(hook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 500);
  }
  await ctx.db.webhookDelivery.create({
    data: {
      webhookId: id,
      event: 'webhook.ping',
      payload: body as unknown as Prisma.InputJsonValue,
      ok,
      statusCode,
      error,
      durationMs: Date.now() - started,
    },
  });
  return { ok, statusCode, error };
}
