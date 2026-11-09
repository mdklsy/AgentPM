import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, extractSessionCookie, type TestWorld } from './helpers.js';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await disposeWorld(w);
});

describe('项目与成员 RBAC', () => {
  it('非法 key 被拒绝', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: w.adminCookie },
      payload: { key: 'bad-key!', name: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('重复 key 409', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: w.adminCookie },
      payload: { key: w.projectKey, name: 'dup' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PROJECT_KEY_TAKEN');
  });

  it('项目详情包含默认工作流与成员', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie: w.adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.myRole).toBe('OWNER');
    const types = body.workflows.map((x: { issueType: string }) => x.issueType);
    expect(types).toEqual(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']);
    const bugFlow = body.workflows.find((x: { issueType: string }) => x.issueType === 'BUG');
    expect(bugFlow.states.map((s: { name: string }) => s.name)).toContain('Resolved');
    // 成员里有人类也有 agent，类型统一建模
    const memberNames = body.members.map((m: { name: string }) => m.name);
    expect(memberNames).toContain(w.agentName);
    expect(memberNames).toContain(w.user2Name);
  });

  it('非成员无法访问项目', async () => {
    // 注册一个无成员关系的用户（注意登录名只允许小写）
    const outsider = `outsider-${Math.random().toString(36).slice(2, 8)}`;
    await w.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: outsider, password: 'outsider-pass-1' },
    });
    const login = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: outsider, password: 'outsider-pass-1' },
    });
    const cookie = extractSessionCookie(login);
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_A_MEMBER');
  });

  it('agent 不能成为 OWNER；非 agent 不能拿 AGENT 角色', async () => {
    const r1 = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: w.agentName, role: 'OWNER' },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: w.user2Name, role: 'AGENT' },
    });
    expect(r2.statusCode).toBe(400);
  });

  it('agent token 走 REST（source=API 审计）', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { authorization: `Bearer ${w.agentToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
