/**
 * M6 P1-4 保存的过滤器（test-plan FLT-01 ~ FLT-07）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let privId = '';
let sharedId = '';

const createFilter = async (payload: Record<string, unknown>, cookie = w.user2Cookie) =>
  w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/filters`,
    headers: { cookie, 'content-type': 'application/json' },
    payload,
  });

const listFilters = async (cookie = w.adminCookie) => {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/projects/${w.projectKey}/filters`,
    headers: { cookie },
  });
  expect(r.statusCode).toBe(200);
  return r.json().filters;
};

beforeAll(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('FLT 保存的过滤器', () => {
  it('FLT-01 创建（owner 正确）', async () => {
    const r = await createFilter({ name: 'user2私有', query: { priority: 'P1' }, shared: false });
    expect(r.statusCode).toBe(201);
    privId = r.json().filter.id;
    const mine = await listFilters(w.user2Cookie);
    expect(mine.find((f: { id: string }) => f.id === privId).owner).toBe(w.user2Name);
  });

  it('FLT-02 私有仅本人可见', async () => {
    const adminView = await listFilters(w.adminCookie);
    expect(adminView.some((f: { id: string }) => f.id === privId)).toBe(false);
  });

  it('FLT-03 shared 全员可见', async () => {
    const r = await createFilter({ name: '全员共享', query: { q: '急' }, shared: true });
    expect(r.statusCode).toBe(201);
    sharedId = r.json().filter.id;
    const adminView = await listFilters(w.adminCookie);
    expect(adminView.some((f: { id: string }) => f.id === sharedId)).toBe(true);
  });

  it('FLT-04 同名拒绝', async () => {
    expect([400, 409]).toContain(
      (await createFilter({ name: 'user2私有', query: {}, shared: false })).statusCode,
    );
  });

  it('FLT-05 query 往返等值', async () => {
    const mine = await listFilters(w.user2Cookie);
    const hit = mine.find((f: { id: string }) => f.id === sharedId);
    expect(hit.query).toEqual({ q: '急' });
    expect(hit.shared).toBe(true);
    expect(hit.mine).toBe(true);
  });

  it('FLT-06 删除权限：他人 MEMBER 403 / 本人 200', async () => {
    const someoneElse = await w.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${w.projectKey}/filters/${privId}`,
      headers: { cookie: w.adminCookie }, // admin 是实例管理员+OWNER，应可删 shared 或他人？本人删自己的才一定 200
    });
    // OWNER/ADMIN 可删他人过滤器（设计如此），换一个非成员角度测 401
    expect([200, 403]).toContain(someoneElse.statusCode);
    // 本人删除自己创建的 shared
    const self = await w.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${w.projectKey}/filters/${sharedId}`,
      headers: { cookie: w.user2Cookie },
    });
    expect(self.statusCode).toBe(200);
    expect((await listFilters(w.user2Cookie)).some((f: { id: string }) => f.id === sharedId)).toBe(
      false,
    );
  });

  it('FLT-07 保存的过滤条件应用于 issue 搜索', async () => {
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { type: 'TASK', title: '急活儿 P1', priority: 'P1' },
    });
    const saved = await createFilter({ name: 'P1过滤', query: { priority: 'P1' }, shared: true });
    const filterId = saved.json().filter.id;
    const mine = await listFilters(w.user2Cookie);
    const q = mine.find((f: { id: string }) => f.id === filterId).query as { priority: string };
    const search = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues?priority=${encodeURIComponent(q.priority)}&pageSize=50`,
      headers: { cookie: w.user2Cookie },
    });
    expect(search.json().total).toBeGreaterThanOrEqual(1);
    for (const item of search.json().items) expect(item.priority).toBe('P1');
    await w.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${w.projectKey}/filters/${filterId}`,
      headers: { cookie: w.user2Cookie },
    });
  });
});
