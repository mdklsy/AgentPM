/**
 * M6 P0-4 批量操作（test-plan BULK-01 ~ BULK-08）
 * 四种 action + 逐项独立失败 + 参数校验 + 权限。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let keys: string[] = [];

async function createIssue(title: string): Promise<string> {
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie: w.adminCookie },
    payload: { type: 'TASK', title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().issue.issueKey as string;
}

const bulk = (payload: Record<string, unknown>, cookie = w.adminCookie) =>
  w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues/bulk`,
    headers: { cookie, 'content-type': 'application/json' },
    payload,
  });

async function getIssue(key: string) {
  const res = await w.app.inject({
    method: 'GET',
    url: `/v1/issues/${key}`,
    headers: { cookie: w.adminCookie },
  });
  return res.json().issue;
}

beforeAll(async () => {
  w = await createWorld();
  keys = [await createIssue('批量一'), await createIssue('批量二'), await createIssue('批量三')];
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('BULK 批量操作', () => {
  it('BULK-01 批量指派 + 逐条审计', async () => {
    const res = await bulk({ issueKeys: keys, action: 'assign', assigneeName: w.user2Name });
    expect(res.statusCode).toBe(200);
    expect(res.json().okCount).toBe(3);
    for (const k of keys) expect(await getIssue(k).then((i) => i.assignee)).toBe(w.user2Name);
    // 审计：issue.assigned × 3
    const acts = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/activities?limit=50`,
      headers: { cookie: w.adminCookie },
    });
    const assigned = acts
      .json()
      .items.filter((a: { action: string }) => a.action === 'issue.assigned');
    expect(assigned.length).toBeGreaterThanOrEqual(3);
  });

  it('BULK-02 批量优先级', async () => {
    const res = await bulk({ issueKeys: keys, action: 'priority', priority: 'P0' });
    expect(res.json().okCount).toBe(3);
    for (const k of keys) expect((await getIssue(k)).priority).toBe('P0');
  });

  it('BULK-03 批量流转', async () => {
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
    });
    const wf = detail.json().workflows.find((x: { issueType: string }) => x.issueType === 'TASK');
    const inProgress = wf.states.find(
      (s: { category: string }) => s.category === 'IN_PROGRESS',
    ).name;
    const res = await bulk({ issueKeys: keys, action: 'transition', toState: inProgress });
    expect(res.json().okCount).toBe(3);
    for (const k of keys)
      expect(await getIssue(k).then((i) => i.stateCategory)).toBe('IN_PROGRESS');
  });

  it('BULK-04 逐项独立失败不连坐', async () => {
    const res = await bulk({
      issueKeys: [keys[0]!, 'NOPE-999', keys[1]!],
      action: 'priority',
      priority: 'P1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.okCount).toBe(2);
    const bad = body.results.find((r: { issueKey: string }) => r.issueKey === 'NOPE-999');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it('BULK-05 action 与参数不匹配拒绝', async () => {
    expect((await bulk({ issueKeys: keys, action: 'assign' })).statusCode).toBe(400);
    expect((await bulk({ issueKeys: keys, action: 'priority' })).statusCode).toBe(400);
    expect((await bulk({ issueKeys: keys, action: 'transition' })).statusCode).toBe(400);
    expect((await bulk({ issueKeys: keys, action: 'sprint' })).statusCode).toBe(400);
  });

  it('BULK-06 issueKeys 上限 100', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `${w.projectKey}-${i + 1}`);
    expect((await bulk({ issueKeys: many, action: 'priority', priority: 'P2' })).statusCode).toBe(
      400,
    );
  });

  it('BULK-07 空列表拒绝', async () => {
    expect((await bulk({ issueKeys: [], action: 'priority', priority: 'P2' })).statusCode).toBe(
      400,
    );
  });

  it('BULK-08 批量挪进 sprint', async () => {
    const sp = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/sprints`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { name: '批量 Sprint' },
    });
    expect(sp.statusCode).toBe(201);
    const sprintId = sp.json().sprint.id as string;
    const res = await bulk({ issueKeys: keys, action: 'sprint', sprintId });
    expect(res.json().okCount).toBe(3);
    for (const k of keys) expect((await getIssue(k)).sprint?.id).toBe(sprintId);
  });

  it('BULK-09 未登录 401', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues/bulk`,
      headers: { 'content-type': 'application/json' },
      payload: { issueKeys: keys, action: 'priority', priority: 'P2' },
    });
    expect(res.statusCode).toBe(401);
  });
});
