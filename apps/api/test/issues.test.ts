import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await disposeWorld(w);
});

async function createIssue(payload: Record<string, unknown>, cookie = w.adminCookie) {
  const res = await w.app.inject({
    method: 'POST',
    url: `/v1/projects/${w.projectKey}/issues`,
    headers: { cookie },
    payload: { type: 'TASK', title: '普通任务', ...payload },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('issue 生命周期', () => {
  it('创建 → 编号连续 → 搜索过滤', async () => {
    const a = await createIssue({ title: '任务A', labelNames: ['core'] });
    const b = await createIssue({ title: '任务B', labelNames: ['ui'] });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.issue.issueKey).toBe(`${w.projectKey}-1`);
    expect(b.body.issue.issueKey).toBe(`${w.projectKey}-2`);

    const search = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      query: { label: 'core' },
    });
    expect(search.json().total).toBe(1);
    expect(search.json().items[0].title).toBe('任务A');

    const q = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      query: { q: '任务B' },
    });
    expect(q.json().total).toBe(1);
  });

  it('SUBTASK 必须有父级', async () => {
    const r = await createIssue({ type: 'SUBTASK', title: '无父' });
    expect(r.status).toBe(400);
  });

  it('合法流转 + closedAt；非法流转被拒', async () => {
    const { body } = await createIssue({ title: '流转测试' });
    const key = body.issue.issueKey;

    // TASK: 待办 → 进行中 合法
    const ok = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { cookie: w.adminCookie },
      payload: { toState: '进行中' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('done');
    expect(ok.json().issue.state).toBe('进行中');

    // TASK: 进行中 → 评审中 不存在（默认任务流无此状态）
    const bad = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { cookie: w.adminCookie },
      payload: { toState: '评审中' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('STATE_NOT_FOUND');

    // → 已完成 设置 closedAt
    const done = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { cookie: w.adminCookie },
      payload: { toState: '已完成' },
    });
    expect(done.json().issue.closedAt).not.toBeNull();

    // reopen 清空 closedAt
    const reopen = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/transition`,
      headers: { cookie: w.adminCookie },
      payload: { toState: '进行中' },
    });
    expect(reopen.json().issue.closedAt).toBeNull();
  });

  it('两个 agent 并发领取同一任务：恰好一个成功（409 另一个）', async () => {
    // 建一个可抢任务
    const { body } = await createIssue({ title: '竞态任务', labelNames: ['race'] });
    const key = body.issue.issueKey;

    const [r1, r2] = await Promise.all([
      w.app.inject({
        method: 'POST',
        url: `/v1/issues/${key}/claim`,
        headers: { authorization: `Bearer ${w.agentToken}` },
        payload: { issueKey: key },
      }),
      w.app.inject({
        method: 'POST',
        url: `/v1/projects/${w.projectKey}/claim`,
        headers: { cookie: w.user2Cookie },
        payload: { issueKey: key },
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const winner = r1.statusCode === 200 ? r1 : r2;
    expect(winner.json().issue.assignee).toBeTruthy();
  });

  it('条件抢单：多候选时高优先级先被抢', async () => {
    await createIssue({ title: '低优', priority: 'P3', labelNames: ['pool'] });
    await createIssue({ title: '高优', priority: 'P0', labelNames: ['pool'] });
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/claim`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { label: 'pool' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().issue.priority).toBe('P0');
  });

  it('领取后释放 → 可再被领取', async () => {
    const { body } = await createIssue({ title: '释放任务', labelNames: ['rl'] });
    const key = body.issue.issueKey;
    const c1 = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/claim`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { issueKey: key },
    });
    expect(c1.statusCode).toBe(200);
    const rel = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/release`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { reason: '依赖未就绪' },
    });
    expect(rel.statusCode).toBe(200);
    expect(rel.json().issue.assignee).toBeNull();
    const c2 = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/claim`,
      headers: { cookie: w.user2Cookie },
      payload: { issueKey: key },
    });
    expect(c2.statusCode).toBe(200);
  });

  it('agent 并发领取上限（maxConcurrentClaims=3）', async () => {
    for (let i = 0; i < 4; i++) {
      await createIssue({ title: `满载${i}`, labelNames: ['cap'] });
    }
    // 独立 agent，避免同文件先前测试占用配额
    const agentRes = await w.app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { cookie: w.adminCookie },
      payload: { name: `cap-bot-${Date.now()}`, description: '上限测试' },
    });
    const capToken = agentRes.json().token as string;
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: agentRes.json().agent.name, role: 'AGENT' },
    });

    for (let i = 0; i < 3; i++) {
      const r = await w.app.inject({
        method: 'POST',
        url: `/v1/projects/${w.projectKey}/claim`,
        headers: { authorization: `Bearer ${capToken}` },
        payload: { label: 'cap' },
      });
      expect(r.statusCode).toBe(200);
    }
    const blocked = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/claim`,
      headers: { authorization: `Bearer ${capToken}` },
      payload: { label: 'cap' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('CLAIM_LIMIT_REACHED');
  });

  it('评论 + 进度汇报 + 活动流审计', async () => {
    const { body } = await createIssue({ title: '审计任务' });
    const key = body.issue.issueKey;
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/claim`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { issueKey: key },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/comments`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { body: '开始分析', evidence: { ref: 'pr#1' } },
    });
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/progress`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { percent: 60, notes: '方案已定' },
    });

    const feed = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/activities`,
      headers: { cookie: w.adminCookie },
      query: { limit: '20' },
    });
    const actions = feed.json().items.map((a: { action: string }) => a.action);
    expect(actions).toContain('task.claimed');
    expect(actions).toContain('comment.added');
    expect(actions).toContain('progress.reported');

    // 按来源过滤：API（token REST）
    const apiFeed = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/activities`,
      headers: { cookie: w.adminCookie },
      query: { source: 'API' },
    });
    for (const a of apiFeed.json().items) expect(a.source).toBe('API');
  });
});
