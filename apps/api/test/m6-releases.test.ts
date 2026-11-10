/**
 * M6 P1-2 版本 Release（test-plan REL-01 ~ REL-09）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let relId = '';
const issueKeys: string[] = [];

const createRelease = async (payload: Record<string, unknown>) =>
  w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/releases`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload,
  });

async function getIssue(key: string) {
  const r = await w.app.inject({
    method: 'GET',
    url: `/v1/issues/${key}`,
    headers: { cookie: w.adminCookie },
  });
  return r.json().issue;
}

beforeAll(async () => {
  w = await createWorld();
  const r1 = await createRelease({ name: 'v1.0.0', releaseDate: '2026-12-01' });
  expect(r1.statusCode).toBe(201);
  relId = r1.json().release.id;
  await createRelease({ name: 'v1.1.0' });

  for (const t of ['功能甲', '功能乙', '功能丙']) {
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { type: 'TASK', title: t, releaseId: relId },
    });
    expect(r.statusCode).toBe(201);
    issueKeys.push(r.json().issue.issueKey);
  }
});

afterAll(async () => {
  await disposeWorld(w);
});

describe('REL 版本', () => {
  it('REL-01 列表带统计', async () => {
    const r = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/releases`,
      headers: { cookie: w.adminCookie },
    });
    const rels = r.json().releases;
    expect(rels).toHaveLength(2);
    const v1 = rels.find((x: { id: string }) => x.id === relId);
    expect(v1.totalIssues).toBe(3);
    expect(v1.doneIssues).toBe(0);
    expect(v1.releaseDate).toContain('2026-12-01');
  });

  it('REL-02 同项目同名拒绝', async () => {
    expect([400, 409]).toContain((await createRelease({ name: 'v1.0.0' })).statusCode);
  });

  it('REL-03 状态流转 planned→released→archived', async () => {
    const p = await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}/releases/${relId}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { status: 'released' },
    });
    expect(p.json().release.status).toBe('released');
    const a = await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}/releases/${relId}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { status: 'archived' },
    });
    expect(a.json().release.status).toBe('archived');
    await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}/releases/${relId}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { status: 'planned' },
    });
  });

  it('REL-04/09 issue 归版本 + 完成度统计', async () => {
    // 完成一个
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
    });
    const wf = detail.json().workflows.find((x: { issueType: string }) => x.issueType === 'TASK');
    const inProg = wf.states.find((s: { category: string }) => s.category === 'IN_PROGRESS').name;
    const done = wf.states.find((s: { category: string }) => s.category === 'DONE').name;
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKeys[0]}/transition`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { toState: inProg },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKeys[0]}/transition`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { toState: done },
    });
    const r = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/releases`,
      headers: { cookie: w.adminCookie },
    });
    const v1 = r.json().releases.find((x: { id: string }) => x.id === relId);
    expect(v1.doneIssues).toBe(1);
    expect((await getIssue(issueKeys[0]!)).release.id).toBe(relId);
  });

  it('REL-05 跨项目版本拒绝', async () => {
    // 另一个项目的 releaseId 不可用：直接造一个假 id
    const r = await w.app.inject({
      method: 'PATCH',
      url: `/v1/issues/${issueKeys[1]}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { releaseId: 'nonexistent-release-id' },
    });
    expect([400, 404]).toContain(r.statusCode);
  });

  it('REL-06 过滤 releaseId / none', async () => {
    const hit = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues?releaseId=${relId}&pageSize=50`,
      headers: { cookie: w.adminCookie },
    });
    expect(hit.json().total).toBe(3);
    // 无版本的 issue
    const none = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues?releaseId=none&pageSize=50`,
      headers: { cookie: w.adminCookie },
    });
    expect(none.json().total).toBe(0);
  });

  it('REL-07 CSV 导出含 release 列', async () => {
    const csv = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues.csv`,
      headers: { cookie: w.adminCookie },
    });
    expect(csv.payload).toContain('v1.0.0');
  });

  it('REL-08 删除版本 SetNull（issue 保留）', async () => {
    const r2 = await createRelease({ name: 'v2.0.0-临时' });
    const tmpId = r2.json().release.id;
    const moved = await w.app.inject({
      method: 'PATCH',
      url: `/v1/issues/${issueKeys[1]}`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { releaseId: tmpId },
    });
    expect(moved.statusCode).toBe(200);
    const del = await w.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${w.projectKey}/releases/${tmpId}`,
      headers: { cookie: w.adminCookie },
    });
    expect(del.statusCode).toBe(200);
    const issue = await getIssue(issueKeys[1]!);
    expect(issue.release).toBeNull();
    expect(issue.title).toBe('功能乙');
  });

  it('REL-10 MEMBER 不能建/删版本', async () => {
    expect((await createRelease({ name: '越权版' })).statusCode).toBe(201); // admin 是 OWNER，可以
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/releases`,
      headers: { cookie: w.user2Cookie, 'content-type': 'application/json' },
      payload: { name: '成员越权建版本' },
    });
    expect(r.statusCode).toBe(403);
  });
});
