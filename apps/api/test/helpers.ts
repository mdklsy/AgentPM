import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getPrisma } from '@agentpm/db';

export interface TestWorld {
  app: FastifyInstance;
  db: ReturnType<typeof getPrisma>;
  adminCookie: string;
  projectKey: string;
  agentName: string;
  agentToken: string;
  /** 归属 admin 的普通用户 */
  user2Name: string;
  user2Cookie: string;
}

/**
 * 每个测试文件一个独立世界：唯一项目 key / 唯一账号名。
 * 注意：vitest 各文件跑在独立 worker，计数器会重置，因此必须用随机后缀防撞。
 * admin（实例管理员）由 global-setup 预置（admin / admin-test-pass-123）。
 */
export async function createWorld(): Promise<TestWorld> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const app = await buildApp();
  const db = getPrisma(process.env.DATABASE_URL);

  const login = async (username: string, password: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username, password },
    });
    if (res.statusCode !== 200) throw new Error(`login ${username} failed: ${res.body}`);
    return extractSessionCookie(res);
  };

  const adminCookie = await login('admin', 'admin-test-pass-123');
  const projectKey = `T${suffix.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
  const projRes = await app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { cookie: adminCookie },
    payload: { key: projectKey, name: `测试项目 ${projectKey}` },
  });
  if (projRes.statusCode !== 201) throw new Error(`project create failed: ${projRes.body}`);

  const agentName = `bot-${suffix}`;
  const agentRes = await app.inject({
    method: 'POST',
    url: '/v1/agents',
    headers: { cookie: adminCookie },
    payload: { name: agentName, description: '测试 agent' },
  });
  if (agentRes.statusCode !== 201) throw new Error(`agent create failed: ${agentRes.body}`);
  const agentToken = agentRes.json().token as string;
  await app.inject({
    method: 'POST',
    url: `/v1/projects/${projectKey}/members`,
    headers: { cookie: adminCookie },
    payload: { actorName: agentName, role: 'AGENT' },
  });

  const user2Name = `human-${suffix}`;
  await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { username: user2Name, password: 'user2-pass-123' },
  });
  const user2Cookie = await login(user2Name, 'user2-pass-123');
  await app.inject({
    method: 'POST',
    url: `/v1/projects/${projectKey}/members`,
    headers: { cookie: adminCookie },
    payload: { actorName: user2Name, role: 'MEMBER' },
  });

  return { app, db, adminCookie, projectKey, agentName, agentToken, user2Name, user2Cookie };
}

export async function disposeWorld(w: TestWorld) {
  await w.app.close();
}

/**
 * 从登录响应提取会话 cookie（`agentpm_session=...`）。
 * 注意：light-my-request 在部分版本/环境下 set-cookie 是字符串而非数组，需兼容两种形态。
 */
export function extractSessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  const hit = list.find((c) => c.startsWith('agentpm_session=')) ?? list[0] ?? '';
  return hit.split(';')[0]!;
}
