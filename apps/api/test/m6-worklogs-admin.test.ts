/**
 * M6 P1-7 工时 + P0-7 管理统计（test-plan WKL-01~07 / ADM-01~05）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let issueKey: string;

async function getDetail() {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/issues/${issueKey}`,
    headers: { cookie: w.adminCookie },
  });
  return r.json().issue;
}

beforeAll(async () => {
  w = await createWorld();
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: { type: 'TASK', title: '工时宿主' },
  });
  issueKey = res.json().issue.issueKey;
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('WKL 工时', () => {
  it('WKL-01/02 登记工时（spentAt 缺省当天）+ 审计', async () => {
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/worklogs`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { minutes: 90 },
    });
    expect(r.statusCode).toBe(201);
    const detail = await getDetail();
    expect(detail.worklogs).toHaveLength(1);
    expect(detail.worklogs[0].minutes).toBe(90);
    expect(detail.worklogs[0].actor).toBe('admin');
    expect(detail.worklogs[0].spentAt.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('WKL-03 列表合计', async () => {
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/worklogs`,
      headers: { cookie: w.user2Cookie, 'content-type': 'application/json' },
      payload: { minutes: 30, comment: '补充调试' },
    });
    const detail = await getDetail();
    expect(detail.worklogTotal).toBe(120);
    expect(detail.worklogs).toHaveLength(2);
    // 不依赖顺序：user2 那条带备注
    const u2 = detail.worklogs.find((x: { actor: string }) => x.actor === w.user2Name);
    expect(u2.comment).toBe('补充调试');
  });

  it('WKL-04 minutes 边界拒绝', async () => {
    expect(
      (
        await w.app.inject({
          method: 'POST',
          url: `/v1/issues/${issueKey}/worklogs`,
          headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
          payload: { minutes: 0 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await w.app.inject({
          method: 'POST',
          url: `/v1/issues/${issueKey}/worklogs`,
          headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
          payload: { minutes: 100001 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('WKL-05 预估工时更新与带出', async () => {
    const r = await w.app.inject({
      method: 'PATCH',
      url: `/v1/issues/${issueKey}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { estimateMinutes: 480 },
    });
    expect(r.statusCode).toBe(200);
    expect((await getDetail()).estimateMinutes).toBe(480);
  });

  it('WKL-06 VIEWER 拒绝登记', async () => {
    const vName = `vw-${Math.random().toString(36).slice(2, 8)}`;
    await w.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: vName, password: 'viewer-pass-123' },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: vName, role: 'VIEWER' },
    });
    const login = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: vName, password: 'viewer-pass-123' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/worklogs`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { minutes: 60 },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('ADM 管理统计', () => {
  it('ADM-01/02 字段齐全且计数含本世界数据', async () => {
    const r = await w.app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { cookie: w.adminCookie },
    });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    for (const k of [
      'users',
      'activeProjects',
      'issues',
      'activeTokens',
      'attachments',
      'activity7d',
    ])
      expect(s[k]).toBeDefined();
    expect(s.users).toBeGreaterThanOrEqual(2);
    expect(s.issues).toBeGreaterThanOrEqual(1);
  });

  it('ADM-04 非实例管理员 403', async () => {
    // 项目 OWNER（非实例 admin）也拿不到——用 user2（MEMBER）验证 403
    const r = await w.app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { cookie: w.user2Cookie },
    });
    expect(r.statusCode).toBe(403);
  });
});
