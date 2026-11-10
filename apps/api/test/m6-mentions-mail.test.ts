/**
 * M6 P0-3 评论 @提及 + P0-6 邮件通知（test-plan MEN-01~05 / MAIL-01~05）
 * 注入假 MailSender 断言外发；SMTP 未配置（默认）不外发。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setMailSender } from '@agentpm/core';

interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

process.env.APP_URL = 'http://test.local';

let w: TestWorld;
let issueKey: string;
const sent: MailMessage[] = [];

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

const comment = (body: string, cookie = w.adminCookie, key = issueKey) =>
  w.app.inject({
    method: 'POST',
    url: `/v1/issues/${key}/comments`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: { body },
  });

async function notificationsOf(cookie: string) {
  const r = await w.app.inject({
    method: 'GET',
    url: '/v1/notifications?limit=50',
    headers: { cookie },
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

beforeAll(async () => {
  w = await createWorld();
  issueKey = await createIssue('提及宿主 issue');
  // user2 设置 email（走管理接口）
  const r = await w.app.inject({
    method: 'PATCH',
    url: `/v1/users/${w.user2Name}`,
    headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
    payload: { email: 'user2@test.local' },
  });
  expect(r.statusCode).toBe(200);
  // 注入假 sender 收集外发邮件
  setMailSender(async (msg) => {
    sent.push(msg);
  });
});

afterAll(async () => {
  setMailSender(null); // 不污染其他文件
  await disposeWorld(w);
});

describe('MEN 评论 @提及', () => {
  it('MEN-01 提及项目成员产生 comment.mentioned', async () => {
    const r = await comment(`请 @${w.user2Name} 看一下这个方案`);
    expect(r.statusCode).toBe(201);
    const data = await notificationsOf(w.user2Cookie);
    const hit = data.items.find(
      (n: { type: string; payload: Record<string, unknown> }) =>
        n.type === 'comment.mentioned' && n.payload.issueKey === issueKey,
    );
    expect(hit).toBeTruthy();
    expect(hit.payload.projectKey).toBe(w.projectKey);
    expect(hit.payload.by).toBe('admin');
  });

  it('MEN-02 提及非成员/不存在账号不通知', async () => {
    const before = (await notificationsOf(w.user2Cookie)).items.length;
    await comment('呼叫 @ghost-user 和 @nobody（都不在项目里）');
    const after = (await notificationsOf(w.user2Cookie)).items.length;
    expect(after).toBe(before);
  });

  it('MEN-05 邮箱样式与 @@ 不误报', async () => {
    const before = (await notificationsOf(w.user2Cookie)).items.length;
    await comment('联系 a@b.c，或 @@admin 双写，@0123 数字开头');
    const after = (await notificationsOf(w.user2Cookie)).items.length;
    expect(after).toBe(before);
  });
});

describe('MAIL 邮件通知', () => {
  it('MAIL-01 指派有 email 的人类 → 外发 1 封', async () => {
    sent.length = 0;
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    expect(r.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 200)); // fire-and-forget 异步
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('user2@test.local');
    expect(sent[0]!.subject).toContain('AgentPM');
    expect(sent[0]!.text).toContain(`/p/${w.projectKey}?issue=${issueKey}`);
  });

  it('MAIL-02 提及也外发（subject 含提及文案）', async () => {
    sent.length = 0;
    await comment(`@${w.user2Name} 再看一眼`);
    await new Promise((res) => setTimeout(res, 200));
    const hit = sent.find((m) => m.to === 'user2@test.local');
    expect(hit).toBeTruthy();
  });

  it('MAIL-05 发送抛错静默（通知仍落库）', async () => {
    setMailSender(async () => {
      throw new Error('smtp down');
    });
    const before = (await notificationsOf(w.user2Cookie)).unread;
    const r = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/assign`,
      headers: { cookie: w.adminCookie, 'content-type': 'application/json' },
      payload: { assigneeName: w.user2Name },
    });
    expect(r.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 200));
    const after = (await notificationsOf(w.user2Cookie)).unread;
    expect(after).toBeGreaterThan(before); // 通知没受邮件失败影响
  });

  it('MAIL-04/06 SMTP 未配置时 admin stats mailConfigured=false', async () => {
    // 测试环境未设置 SMTP_HOST
    const r = await w.app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { cookie: w.adminCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mailConfigured).toBe(false);
  });
});
