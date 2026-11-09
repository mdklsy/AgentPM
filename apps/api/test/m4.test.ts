import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let srv: Server;
let port: number;
const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> =
  [];

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  w = await createWorld();
  srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  port = (srv.address() as { port: number }).port;
});
afterAll(async () => {
  await disposeWorld(w);
  srv.close();
});

describe('M4 · webhook 投递与签名', () => {
  it('创建 webhook（secret 仅一次返回）→ 触发事件 → HMAC 签名投递 + 日志', async () => {
    const created = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/webhooks`,
      headers: { cookie: w.adminCookie },
      payload: { url: `http://127.0.0.1:${port}/hook`, events: ['*'] },
    });
    expect(created.statusCode).toBe(201);
    const secret = created.json().secret as string;
    expect(secret.startsWith('whsec_')).toBe(true);

    // 触发：建 issue（会发 issue.created）
    const issue = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      payload: { type: 'TASK', title: 'webhook 触发任务' },
    });
    expect(issue.statusCode).toBe(201);

    await waitFor(() => received.some((r) => r.body.includes(issue.json().issue.issueKey)));
    const hit = received.find((r) => r.body.includes(issue.json().issue.issueKey))!;
    const parsed = JSON.parse(hit.body);
    expect(parsed.event).toBe('issue.created');
    expect(parsed.data.issueKey).toBe(issue.json().issue.issueKey);

    const expected = 'sha256=' + createHmac('sha256', secret).update(hit.body).digest('hex');
    expect(hit.headers['x-agentpm-signature']).toBe(expected);
    expect(hit.headers['x-agentpm-event']).toBe('issue.created');

    // 投递日志
    const hookId = created.json().webhook.id as string;
    await waitFor(async () => {
      const d = await w.app.inject({
        method: 'GET',
        url: `/v1/projects/${w.projectKey}/webhooks/${hookId}/deliveries`,
        headers: { cookie: w.adminCookie },
      });
      return (d.json().deliveries as unknown[]).some((x) => (x as { ok: boolean }).ok);
    });
  });

  it('ping 测试投递', async () => {
    const hooks = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/webhooks`,
      headers: { cookie: w.adminCookie },
    });
    const id = hooks.json().webhooks[0].id as string;
    const ping = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/webhooks/${id}/ping`,
      headers: { cookie: w.adminCookie },
    });
    expect(ping.statusCode).toBe(200);
    expect(ping.json().ok).toBe(true);
    await waitFor(() => received.some((r) => r.body.includes('webhook.ping')));
  });

  it('非管理员不能管理 webhook', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/webhooks`,
      headers: { cookie: w.user2Cookie },
      payload: { url: `http://127.0.0.1:${port}/x` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('M4 · 站内通知', () => {
  it('评论 → 指派人/报告人收到通知（不含触发者）', async () => {
    // admin 建 issue 并指派给 user2
    const issue = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      payload: { type: 'TASK', title: '通知任务', assigneeName: w.user2Name },
    });
    const key = issue.json().issue.issueKey as string;
    // admin 评论
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/comments`,
      headers: { cookie: w.adminCookie },
      payload: { body: '一条会触发通知的评论' },
    });

    const list = await w.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { cookie: w.user2Cookie },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ type: string; payload: { issueKey?: string } }>;
    expect(items.some((n) => n.type === 'issue.assigned' && n.payload.issueKey === key)).toBe(true);
    expect(items.some((n) => n.type === 'comment.added' && n.payload.issueKey === key)).toBe(true);
    expect(list.json().unread).toBeGreaterThanOrEqual(2);

    // 触发者（admin）不应收到自己的动作通知
    const adminList = await w.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { cookie: w.adminCookie },
    });
    const adminItems = adminList.json().items as Array<{ payload: { issueKey?: string } }>;
    expect(adminItems.some((n) => n.payload.issueKey === key)).toBe(false);

    // 全部已读
    await w.app.inject({
      method: 'POST',
      url: '/v1/notifications/read-all',
      headers: { cookie: w.user2Cookie },
    });
    const after = await w.app.inject({
      method: 'GET',
      url: '/v1/notifications?unreadOnly=true',
      headers: { cookie: w.user2Cookie },
    });
    expect(after.json().unread).toBe(0);
  });

  it('审批请求 → 管理员收到通知；决定 → 发起者收到通知', async () => {
    // 开完成审批策略 → agent 完成 → 通知管理员
    await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
      payload: { agentPolicy: { completeTransition: 'approval' } },
    });
    const issue = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      payload: { type: 'TASK', title: '审批通知任务' },
    });
    const key = issue.json().issue.issueKey as string;
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/claim`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: {},
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { toState: 'In Progress' },
    });
    const toDone = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { toState: 'Done' },
    });
    const approvalId = toDone.json().approvalId as string;

    const adminList = await w.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { cookie: w.adminCookie },
    });
    expect(
      (adminList.json().items as Array<{ type: string }>).some(
        (n) => n.type === 'approval.requested',
      ),
    ).toBe(true);

    // 批准 → agent 收到决定通知（agent 无法登 web，直接查库验证）
    await w.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decision`,
      headers: { cookie: w.adminCookie },
      payload: { decision: 'APPROVED' },
    });
    const agentNotif = await w.db.notification.findFirst({
      where: { recipient: { name: w.agentName }, type: 'approval.decided' },
    });
    expect(agentNotif).not.toBeNull();
    expect((agentNotif!.payload as { decision: string }).decision).toBe('APPROVED');
  });
});

describe('M4 · Sprint 燃尽与速率', () => {
  it('排期/完成流转 → 燃尽曲线正确；完成 Sprint → 未完成退回 Backlog；速率统计', async () => {
    const sprint = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/sprints`,
      headers: { cookie: w.adminCookie },
      payload: {
        name: 'M4 燃尽 Sprint',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 10 * 86400_000).toISOString(),
        status: 'ACTIVE',
      },
    });
    expect(sprint.statusCode).toBe(201);
    const sprintId = sprint.json().sprint.id as string;

    const keys: string[] = [];
    for (const t of ['燃尽任务A', '燃尽任务B', '燃尽任务C']) {
      const r = await w.app.inject({
        method: 'POST',
        url: `/v1/projects/${w.projectKey}/issues`,
        headers: { cookie: w.adminCookie },
        payload: { type: 'TASK', title: t },
      });
      keys.push(r.json().issue.issueKey);
      await w.app.inject({
        method: 'POST',
        url: `/v1/issues/${r.json().issue.issueKey}/sprint`,
        headers: { cookie: w.adminCookie },
        payload: { sprintId },
      });
    }
    // 完成 A、B（工作流要求先 In Progress 再 Done）
    for (const k of keys.slice(0, 2)) {
      await w.app.inject({
        method: 'POST',
        url: `/v1/issues/${k}/transition`,
        headers: { cookie: w.adminCookie },
        payload: { toState: 'In Progress' },
      });
      const done = await w.app.inject({
        method: 'POST',
        url: `/v1/issues/${k}/transition`,
        headers: { cookie: w.adminCookie },
        payload: { toState: 'Done' },
      });
      expect(done.statusCode).toBe(200);
    }

    const bd = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/sprints/${sprintId}/burndown`,
      headers: { cookie: w.adminCookie },
    });
    expect(bd.statusCode).toBe(200);
    const body = bd.json();
    expect(body.total).toBe(3);
    const points = body.points as Array<{ remaining: number; ideal: number }>;
    expect(points.length).toBeGreaterThanOrEqual(2);
    // 全部事件发生在今天：A、B 当日完成 → 曲线恒为 1（单调不增）
    expect(points[0]!.remaining).toBe(1);
    expect(points[points.length - 1]!.remaining).toBe(1);
    expect(points[points.length - 1]!.ideal).toBe(0);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.remaining).toBeLessThanOrEqual(points[i - 1]!.remaining);
    }

    // 完成 Sprint → C 退回 Backlog
    const done = await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}/sprints/${sprintId}/status`,
      headers: { cookie: w.adminCookie },
      payload: { status: 'COMPLETED' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().returnedToBacklog).toBe(1);
    const c = await w.db.issue.findUniqueOrThrow({ where: { issueKey: keys[2] } });
    expect(c.sprintId).toBeNull();

    // 速率：已完成的 sprint 里 done 计 2（A、B closedAt 在 sprint 期内）
    const vel = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/velocity`,
      headers: { cookie: w.adminCookie },
    });
    const items = vel.json().items as Array<{ name: string; done: number; total: number }>;
    const hit = items.find((i) => i.name === 'M4 燃尽 Sprint');
    expect(hit?.done).toBe(2);
    expect(hit?.total).toBe(2); // C 已退回，Sprint 内剩 2
  });
});
