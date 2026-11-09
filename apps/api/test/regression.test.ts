import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await disposeWorld(w);
});

describe('回归提交与 bug 自动化', () => {
  it('失败用例自动建 bug；同指纹重跑不重复建单', async () => {
    const submit = (fingerprint: string, status: 'FAIL' | 'PASS') =>
      w.app.inject({
        method: 'POST',
        url: `/v1/projects/${w.projectKey}/regression-runs`,
        headers: { authorization: `Bearer ${w.agentToken}` },
        payload: {
          suite: 'unit',
          branch: 'main',
          results: [
            { name: 'case.ok', status: 'PASS' },
            { name: 'case.boom', status, message: 'AssertionError: expected 1 got 2', fingerprint },
          ],
        },
      });

    const r1 = await submit('fp:boom', 'FAIL');
    expect(r1.statusCode).toBe(201);
    expect(r1.json().status).toBe('FAILED');
    expect(r1.json().filedBugs).toHaveLength(1);
    expect(r1.json().filedBugs[0].status).toBe('created');
    const bugKey = r1.json().filedBugs[0].issueKey as string;

    // 同指纹再次失败 → 去重（deduplicated）
    const r2 = await submit('fp:boom', 'FAIL');
    expect(r2.json().filedBugs[0].status).toBe('deduplicated');
    expect(r2.json().filedBugs[0].issueKey).toBe(bugKey);

    // 项目内 BUG 总数仍为 1
    const bugs = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      query: { type: 'BUG' },
    });
    expect(bugs.json().total).toBe(1);

    // 去重并入的评论在 bug 上
    const detail = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${bugKey}`,
      headers: { cookie: w.adminCookie },
    });
    expect(detail.json().issue.comments.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(detail.json().issue.comments)).toContain('fp:boom');
  });

  it('全绿运行 PASSED，不建单', async () => {
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/regression-runs`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { suite: 'unit', results: [{ name: 'all.good', status: 'PASS' }] },
    });
    expect(r.json().status).toBe('PASSED');
    expect(r.json().filedBugs).toHaveLength(0);
  });

  it('运行历史可查询', async () => {
    const r = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/regression-runs`,
      headers: { cookie: w.adminCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().runs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('agent 策略审批', () => {
  it('completeTransition=approval 时 agent 完成 → 审批队列 → 批准后完成', async () => {
    // 开启审批策略
    const upd = await w.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
      payload: { agentPolicy: { completeTransition: 'approval' } },
    });
    expect(upd.statusCode).toBe(200);

    // 建任务 → agent 领取 → 流转到 In Progress → Done 触发审批
    const created = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      payload: { type: 'TASK', title: '审批链路' },
    });
    const key = created.json().issue.issueKey;
    await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${key}/claim`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      payload: { issueKey: key },
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
    expect(toDone.json().status).toBe('pending_approval');
    const approvalId = toDone.json().approvalId as string;

    // agent 视角：approvals.list 能看到自己的待审批
    const mine = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/approvals`,
      headers: { authorization: `Bearer ${w.agentToken}` },
      query: { status: 'PENDING' },
    });
    expect(mine.json().approvals.map((a: { id: string }) => a.id)).toContain(approvalId);

    // 期间 issue 仍是 In Progress
    const mid = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${key}`,
      headers: { cookie: w.adminCookie },
    });
    expect(mid.json().issue.state).toBe('In Progress');

    // 管理员批准 → 系统代执行 → Done
    const approve = await w.app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decision`,
      headers: { cookie: w.adminCookie },
      payload: { decision: 'APPROVED', reason: '代码已 review' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().execution.status).toBe('done');

    const after = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${key}`,
      headers: { cookie: w.adminCookie },
    });
    expect(after.json().issue.state).toBe('Done');
    expect(after.json().issue.closedAt).not.toBeNull();

    // 审计：SYSTEM 代执行留痕（issue.transitioned）；审批决策本身由管理员 WEB 操作产生
    const sysFeed = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/activities`,
      headers: { cookie: w.adminCookie },
      query: { source: 'SYSTEM' },
    });
    const sysActions = sysFeed.json().items.map((a: { action: string }) => a.action);
    expect(sysActions).toContain('issue.transitioned');

    const allFeed = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/activities`,
      headers: { cookie: w.adminCookie },
      query: { limit: '100' },
    });
    const actions = allFeed.json().items.map((a: { action: string }) => a.action);
    expect(actions).toContain('approval.decided');
    expect(actions).toContain('approval.requested');
  });
});
