/**
 * M6 P0-5 我的工作（test-plan MYW-01 ~ MYW-07）
 * 三组分类 / 排序 / 跨项目聚合 / 数据隔离。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let keyA = '';
let keyB = '';

const myWork = (cookie = w.user2Cookie) =>
  w.app
    .inject({
      method: 'GET',
      url: '/v1/my/work',
      headers: { cookie },
    })
    .then((r) => {
      expect(r.statusCode).toBe(200);
      return r.json();
    });

async function createIssue(projectKey: string, title: string, cookie = w.adminCookie) {
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${projectKey}/issues`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: { type: 'TASK', title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().issue.issueKey as string;
}

beforeAll(async () => {
  w = await createWorld();
  // 第二个项目：admin 建、把 user2 拉进去
  const suffix = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
  keyB = `W${suffix}${Math.floor(Math.random() * 90 + 10)}`;
  const pc = await w.app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { cookie: w.adminCookie },
    payload: { key: keyB, name: '我的工作第二项目' },
  });
  expect([201, 400]).toContain(pc.statusCode); // key 撞车兜底
  if (pc.statusCode === 400) keyB = `W${suffix}${Math.floor(Math.random() * 90 + 10)}`;
  await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${keyB}/members`,
    headers: { cookie: w.adminCookie },
    payload: { actorName: w.user2Name, role: 'MEMBER' },
  });
  keyA = w.projectKey;
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('MYW 我的工作', () => {
  it('MYW-01 指派分组（跨项目聚合）', async () => {
    const a = await createIssue(keyA, '指派给 user2 的 A');
    const b = await createIssue(keyB, '指派给 user2 的 B');
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${a}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${b}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    const data = await myWork();
    const keys = data.assigned.map((i: { issueKey: string }) => i.issueKey);
    expect(keys).toContain(a);
    expect(keys).toContain(b);
    const item = data.assigned.find((i: { issueKey: string }) => i.issueKey === a);
    expect(item.projectKey).toBe(keyA);
    expect(item.stateCategory).toBeDefined();
  });

  it('MYW-02 关注分组', async () => {
    const x = await createIssue(keyA, 'user2 关注的（别人创建）');
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${x}/watch`,
      headers: { cookie: w.user2Cookie, 'content-type': 'application/json' },
      payload: { watch: true },
    });
    expect(r.statusCode).toBe(200);
    const data = await myWork();
    expect(data.watching.some((i: { issueKey: string }) => i.issueKey === x)).toBe(true);
  });

  it('MYW-03 报告分组（reporter=创建人）', async () => {
    const y = await createIssue(keyA, 'user2 自己提的', w.user2Cookie);
    const data = await myWork();
    expect(data.reported.some((i: { issueKey: string }) => i.issueKey === y)).toBe(true);
  });

  it('MYW-04 未完成排在已完成前面', async () => {
    const open = await createIssue(keyA, '未完成-应靠前');
    const done = await createIssue(keyA, '已完成-应靠后');
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${done}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${open}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    // 完成 done
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${keyA}`,
      headers: { cookie: w.adminCookie },
    });
    const wf = detail.json().workflows.find((x: { issueType: string }) => x.issueType === 'TASK');
    const inProgState = wf.states.find(
      (s: { category: string }) => s.category === 'IN_PROGRESS',
    ).name;
    const doneState = wf.states.find((s: { category: string }) => s.category === 'DONE').name;
    // 默认迁移表：待办→进行中→完成（不能跳步）
    const t1 = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${done}/transition`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { toState: inProgState },
    });
    expect(t1.statusCode).toBe(200);
    const t2 = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${done}/transition`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { toState: doneState },
    });
    expect(t2.statusCode).toBe(200);

    const data = await myWork();
    const keys = data.assigned.map((i: { issueKey: string }) => i.issueKey);
    expect(keys.indexOf(open)).toBeLessThan(keys.indexOf(done));
  });

  it('MYW-05 数据隔离：user1 看不到 user2 的专属', async () => {
    // user2 被指派、user1（admin）没有
    const data = await myWork(w.adminCookie);
    // admin 世界里 user2 的 issue 不在其 assigned（admin 自己没被指派这些）
    const titles = data.assigned.map((i: { title: string }) => i.title);
    expect(titles).not.toContain('指派给 user2 的 A');
  });

  it('MYW-06 未登录 401', async () => {
    const r = await w.app.inject({ method: 'GET', url: '/v1/my/work' });
    expect(r.statusCode).toBe(401);
  });
});
