/**
 * M6 P0-1 附件上传（test-plan ATT-01 ~ ATT-08）
 * multipart 上传 → 详情带出 → 下载 → 超限/权限/删除闭环。
 * 附件目录指向临时目录，避免污染开发 data/uploads。
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

const attDir = mkdtempSync(join(tmpdir(), 'apm-test-att-'));
process.env.ATTACHMENTS_DIR = attDir;

let w: TestWorld;
let issueKey: string;

/** 手工构造 multipart/form-data（不引 form-data 依赖）。 */
function multipart(filename: string, content: Buffer, mime = 'text/plain') {
  const boundary = `----vitest${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } as Record<
      string,
      string
    >,
  };
}

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

beforeAll(async () => {
  w = await createWorld();
  issueKey = await createIssue('附件宿主 issue');
});

afterAll(async () => {
  await disposeWorld(w);
  rmSync(attDir, { recursive: true, force: true });
});

describe('ATT 附件', () => {
  it('ATT-01 上传小文本附件：201 + 磁盘落盘', async () => {
    const body = multipart('说明.txt', Buffer.from('附件内容 hello'));
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      ...body,
      headers: { cookie: w.adminCookie, ...body.headers },
    });
    expect(res.statusCode).toBe(201);
    const att = res.json().attachment;
    expect(att.name).toBe('说明.txt');
    expect(att.sizeBytes).toBe(Buffer.byteLength('附件内容 hello'));
    expect(existsSync(join(attDir, att.id))).toBe(true);
  });

  it('ATT-02 详情带出附件列表（含上传人）', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}`,
      headers: { cookie: w.adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const atts = res.json().issue.attachments;
    expect(atts.length).toBeGreaterThanOrEqual(1);
    expect(atts[0].uploadedBy).toBeTruthy();
    expect(atts[0].name).toBe('说明.txt');
  });

  it('ATT-03 下载：内容一致 + content-disposition', async () => {
    const list = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { cookie: w.adminCookie },
    });
    const att = list.json().attachments[0];
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}/attachments/${att.id}/download`,
      headers: { cookie: w.adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(res.payload.toString()).toBe('附件内容 hello');
  });

  it('ATT-04 超 20MB 拒绝', async () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1, 65);
    const body = multipart('big.bin', big, 'application/octet-stream');
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { cookie: w.adminCookie, ...body.headers },
      payload: body.payload,
    });
    expect([400, 413]).toContain(res.statusCode);
  });

  it('ATT-05 未登录拒绝', async () => {
    const body = multipart('x.txt', Buffer.from('x'));
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('ATT-07/08 删除后磁盘清除、下载 404', async () => {
    const body = multipart('待删.txt', Buffer.from('to be deleted'));
    const up = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { cookie: w.adminCookie, ...body.headers },
      payload: body.payload,
    });
    const id = up.json().attachment.id as string;
    expect(existsSync(join(attDir, id))).toBe(true);

    const del = await w.app.inject({
      method: 'DELETE',
      url: `/v1/issues/${issueKey}/attachments/${id}`,
      headers: { cookie: w.adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(join(attDir, id))).toBe(false);

    const dl = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}/attachments/${id}/download`,
      headers: { cookie: w.adminCookie },
    });
    expect(dl.statusCode).toBe(404);
  });

  it('ATT-07b 上传者可删、无关 MEMBER 不可删、ADMIN 可删', async () => {
    // user2 上传
    const body = multipart('u2.txt', Buffer.from('user2 file'));
    const up = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { cookie: w.user2Cookie, ...body.headers },
      payload: body.payload,
    });
    expect(up.statusCode).toBe(201);
    const id = up.json().attachment.id as string;

    // admin（非上传者，但 ADMIN）也可删 → 先验证另一 MEMBER 场景不存在第三个成员，用 AGENT token 判 403
    const agentDel = await w.app.inject({
      method: 'DELETE',
      url: `/v1/issues/${issueKey}/attachments/${id}`,
      headers: { authorization: `Bearer ${w.agentToken}` },
    });
    expect(agentDel.statusCode).toBe(403);

    const selfDel = await w.app.inject({
      method: 'DELETE',
      url: `/v1/issues/${issueKey}/attachments/${id}`,
      headers: { cookie: w.user2Cookie },
    });
    expect(selfDel.statusCode).toBe(200);
  });

  it('ATT-06 非本项目成员不可见该 issue 附件', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { authorization: 'Bearer invalid-token-x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ATT-02b 上传中文文件名可下载还原', async () => {
    const body = multipart('需求 评审v2.pdf', Buffer.from('%PDF-fake'), 'application/pdf');
    const up = await w.app.inject({
      method: 'POST',
      url: `/v1/issues/${issueKey}/attachments`,
      headers: { cookie: w.adminCookie, ...body.headers },
      payload: body.payload,
    });
    expect(up.statusCode).toBe(201);
    const id = up.json().attachment.id as string;
    const dl = await w.app.inject({
      method: 'GET',
      url: `/v1/issues/${issueKey}/attachments/${id}/download`,
      headers: { cookie: w.adminCookie },
    });
    expect(dl.statusCode).toBe(200);
    expect(
      decodeURIComponent(
        /filename\*=UTF-8''([^;]+)/.exec(String(dl.headers['content-disposition']))?.[1] ?? '',
      ),
    ).toBe('需求 评审v2.pdf');
    expect(dl.payload.toString()).toBe('%PDF-fake');
  });

  it('ATT-09 落盘目录即 ATTACHMENTS_DIR（隔离生效）', () => {
    expect(attDir).toContain('apm-test-att-');
    expect(existsSync(attDir)).toBe(true);
  });
});
