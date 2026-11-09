import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
const AVATAR_PNG =
  'data:image/png;base64,' +
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
      '0d0a2db40000000049454e44ae426082',
    'hex',
  ).toString('base64');

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await disposeWorld(w);
});

/* ---------------- 花名册与权限 ---------------- */

describe('M5.5 · 团队管理', () => {
  it('管理员列全量（含邮箱/管理员标志）；普通用户脱敏', async () => {
    const admin = await w.app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: { cookie: w.adminCookie },
    });
    expect(admin.statusCode).toBe(200);
    const adminUsers = admin.json().users as Array<Record<string, unknown>>;
    const me = adminUsers.find((u) => u.name === 'admin');
    expect(me?.email).toBeDefined();
    expect(me?.isAdmin).toBe(true);
    expect(me).not.toHaveProperty('passwordHash');
    expect(me?.hasPassword).toBe(true);

    const plain = await w.app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: { cookie: w.user2Cookie },
    });
    expect(plain.statusCode).toBe(200);
    const plainUsers = plain.json().users as Array<Record<string, unknown>>;
    expect(plainUsers.length).toBeGreaterThan(0);
    expect(plainUsers[0]).not.toHaveProperty('email');
    expect(plainUsers[0]).not.toHaveProperty('isAdmin');
  });

  it('管理员建用户 → 新用户可登录（mustChangePassword）', async () => {
    const name = `newbie-${Math.random().toString(36).slice(2, 8)}`;
    const created = await w.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { cookie: w.adminCookie },
      payload: { name, displayName: '新手', password: 'starter-pass-1', mustChangePassword: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user.hasPassword).toBe(true);

    const login = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: name, password: 'starter-pass-1' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().actor.mustChangePassword).toBe(true);
  });

  it('普通用户建用户 → 403；重名 → 409', async () => {
    const denied = await w.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { cookie: w.user2Cookie },
      payload: { name: `x-${Date.now()}`, displayName: 'x', password: 'whatever-123' },
    });
    expect(denied.statusCode).toBe(403);

    const dup = await w.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { cookie: w.adminCookie },
      payload: { name: 'admin', displayName: '重复', password: 'whatever-123' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('重置密码：旧密码失效、新密码生效、强制改密；停用后无法登录', async () => {
    const name = `reset-${Math.random().toString(36).slice(2, 8)}`;
    await w.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { cookie: w.adminCookie },
      payload: { name, displayName: '重置测试', password: 'first-pass-123' },
    });

    const reset = await w.app.inject({
      method: 'PATCH',
      url: `/v1/users/${name}`,
      headers: { cookie: w.adminCookie },
      payload: { newPassword: 'second-pass-456' },
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: name, password: 'first-pass-123' },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: name, password: 'second-pass-456' },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().actor.mustChangePassword).toBe(true);

    const off = await w.app.inject({
      method: 'PATCH',
      url: `/v1/users/${name}`,
      headers: { cookie: w.adminCookie },
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    const disabledLogin = await w.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: name, password: 'second-pass-456' },
    });
    expect(disabledLogin.statusCode).toBe(403); // 停用账号：ACTOR_INACTIVE
  });

  it('守卫：不能停用/降级自己；普通用户改他人 → 403', async () => {
    const selfOff = await w.app.inject({
      method: 'PATCH',
      url: '/v1/users/admin',
      headers: { cookie: w.adminCookie },
      payload: { isActive: false },
    });
    expect(selfOff.statusCode).toBe(400);

    const other = await w.app.inject({
      method: 'PATCH',
      url: '/v1/users/admin',
      headers: { cookie: w.user2Cookie },
      payload: { isActive: false },
    });
    expect(other.statusCode).toBe(403);
  });

  it('头像：本人上传 dataURL → me 返回；非法格式 400；他人上传 403', async () => {
    const self = await w.app.inject({
      method: 'POST',
      url: `/v1/users/${w.user2Name}/avatar`,
      headers: { cookie: w.user2Cookie },
      payload: { dataUrl: AVATAR_PNG },
    });
    expect(self.statusCode).toBe(200);

    const me = await w.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: w.user2Cookie },
    });
    expect(me.json().actor.avatarUrl).toBe(AVATAR_PNG);

    const bad = await w.app.inject({
      method: 'POST',
      url: `/v1/users/${w.user2Name}/avatar`,
      headers: { cookie: w.user2Cookie },
      payload: { dataUrl: 'data:text/html;base64,PGI+' },
    });
    expect(bad.statusCode).toBe(400);

    const other = await w.app.inject({
      method: 'POST',
      url: `/v1/users/admin/avatar`,
      headers: { cookie: w.user2Cookie },
      payload: { dataUrl: AVATAR_PNG },
    });
    expect(other.statusCode).toBe(403);
  });

  it('选人搜索（登录即可，脱敏）', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/actors/search?q=${w.user2Name.slice(0, 6)}`,
      headers: { cookie: w.user2Cookie },
    });
    expect(res.statusCode).toBe(200);
    const actors = res.json().actors as Array<Record<string, unknown>>;
    expect(actors.some((a) => a.name === w.user2Name)).toBe(true);
    expect(actors[0]).not.toHaveProperty('email');
  });
});
