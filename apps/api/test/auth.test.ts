import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await disposeWorld(w);
});

describe('认证与 token', () => {
  it('错误密码被拒绝', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'admin', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('BAD_CREDENTIALS');
  });

  it('me 返回当前用户', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: w.adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().actor.name).toBe('admin');
  });

  it('匿名访问受保护接口 401', async () => {
    const res = await w.app.inject({ method: 'GET', url: '/v1/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('创建 token → Bearer 访问 REST → 吊销后 401', async () => {
    const created = await w.app.inject({
      method: 'POST',
      url: '/v1/tokens',
      headers: { cookie: w.adminCookie },
      payload: { name: 'ci-token', scopes: ['read', 'write'] },
    });
    expect(created.statusCode).toBe(201);
    const plaintext = created.json().plaintext as string;
    expect(plaintext.startsWith('apm_')).toBe(true);

    const ok = await w.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().actor.name).toBe('admin');

    // 只读 scope 不能写
    const ro = await w.app.inject({
      method: 'POST',
      url: '/v1/tokens',
      headers: { cookie: w.adminCookie },
      payload: { name: 'ro', scopes: ['read'] },
    });
    const roToken = ro.json().plaintext as string;
    const write = await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { authorization: `Bearer ${roToken}` },
      payload: { type: 'TASK', title: 'x' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('SCOPE_MISSING');

    // 吊销
    const list = await w.app.inject({
      method: 'GET',
      url: '/v1/tokens',
      headers: { cookie: w.adminCookie },
    });
    const id = (list.json().tokens as Array<{ id: string; name: string }>).find(
      (t) => t.name === 'ci-token',
    )!.id;
    await w.app.inject({
      method: 'DELETE',
      url: `/v1/tokens/${id}`,
      headers: { cookie: w.adminCookie },
    });
    const revoked = await w.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('TOKEN_REVOKED');
  });

  it('伪造 token 被拒', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer apm_totally_fake_token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
