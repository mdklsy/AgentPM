import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';

let w: TestWorld;
let baseUrl: string;

const require_ = createRequire(import.meta.url);

async function httpClient() {
  const transport = new StreamableHTTPClientTransport(new URL('/v1/mcp', baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${w.agentToken}` } },
  });
  const client = new Client({ name: 'vitest-http', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  w = await createWorld();
  await w.app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(w.app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await disposeWorld(w);
});

describe('MCP over Streamable HTTP', () => {
  it('initialize + 工具清单齐全', async () => {
    const client = await httpClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      for (const expected of [
        'project.list',
        'project.stats',
        'issue.search',
        'issue.claim',
        'issue.transition',
        'progress.report',
        'bug.report',
        'regression.submit',
        'agent.heartbeat',
        'approvals.list',
      ]) {
        expect(names).toContain(expected);
      }
      expect(names.length).toBeGreaterThanOrEqual(20);
    } finally {
      await client.close();
    }
  });

  it('资源可读', async () => {
    const client = await httpClient();
    try {
      const res = await client.readResource({ uri: 'agentpm://projects' });
      const text = (res.contents[0] as { text?: string } | undefined)?.text ?? '';
      expect(JSON.parse(text).some((p: { key: string }) => p.key === w.projectKey)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('无 token 401', async () => {
    const transport = new StreamableHTTPClientTransport(new URL('/v1/mcp', baseUrl), {
      requestInit: { headers: {} },
    });
    const client = new Client({ name: 'anon', version: '0' }, { capabilities: {} });
    await expect(client.connect(transport)).rejects.toThrow();
    await client.close().catch(() => {});
  });

  it('全链路：建单 → 领取 → 进度 → 提bug → 回归 → 统计 → 审计', async () => {
    // 人类建两个可抢任务
    for (const t of ['MCP 任务一', 'MCP 任务二']) {
      await w.app.inject({
        method: 'POST',
        url: `/v1/projects/${w.projectKey}/issues`,
        headers: { cookie: w.adminCookie },
        payload: { type: 'TASK', title: t, labelNames: ['mcp'] },
      });
    }

    const client = await httpClient();
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
        return JSON.parse((r.content as Array<{ text?: string }>)[0]?.text ?? '{}');
      };

      // 抢单
      const claim = await call('issue.claim', { projectKey: w.projectKey, label: 'mcp' });
      const key = claim.issue.issueKey as string;
      expect(claim.issue.assignee).toBe(w.agentName);

      // 看板资源
      const board = await client.readResource({ uri: `agentpm://project/${w.projectKey}/board` });
      expect((board.contents[0] as { text?: string } | undefined)?.text).toContain(key);

      // 进度
      const prog = await call('progress.report', {
        issueKey: key,
        percent: 50,
        notes: 'MCP 汇报',
        artifacts: [{ name: 'branch', url: 'https://example.com/b/1' }],
      });
      expect(prog.percent).toBe(50);

      // 流转 进行中（agent 非完成态，不需审批）
      const tr = await call('issue.transition', { issueKey: key, toState: '进行中' });
      expect(tr.status).toBe('done');

      // 提 bug（带指纹）
      const bug = await call('bug.report', {
        projectKey: w.projectKey,
        title: 'MCP 发现的缺陷',
        severity: 'P1',
        fingerprint: 'mcp:fp1',
        evidence: { stack: 'Error: boom' },
      });
      expect(bug.status).toBe('created');

      // 回归：一个失败用例复用同一指纹 → 应去重
      const reg = await call('regression.submit', {
        projectKey: w.projectKey,
        suite: 'e2e',
        results: [
          { name: 'a.pass', status: 'PASS' },
          { name: 'mcp 发现的缺陷 用例', status: 'FAIL', fingerprint: 'mcp:fp1' },
        ],
      });
      expect(reg.status).toBe('FAILED');
      expect(reg.filedBugs[0].status).toBe('deduplicated');
      expect(reg.filedBugs[0].issueKey).toBe(bug.issue.issueKey);

      // 统计与审计
      const stats = await call('project.stats', { projectKey: w.projectKey });
      expect(stats.totals.total).toBeGreaterThanOrEqual(3);
      expect(
        stats.workload.members.find((m: { name: string }) => m.name === w.agentName),
      ).toBeTruthy();

      const activity = await call('project.activity', {
        projectKey: w.projectKey,
        source: 'MCP',
        limit: 50,
      });
      const actions = activity.items.map((a: { action: string }) => a.action);
      for (const a of [
        'task.claimed',
        'progress.reported',
        'issue.transitioned',
        'bug.deduplicated',
        'regression.submitted',
      ]) {
        expect(actions).toContain(a);
      }
    } finally {
      await client.close();
    }
  });
});

describe('MCP over stdio 网关', () => {
  it('stdio 网关代理 HTTP 端点：initialize + tools/list + callTool', async () => {
    // Node ≥ 23 原生支持类型剥离，直接以 node 运行网关 TS 源码
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        require_.resolve('../../mcp-stdio/src/main.ts'),
        '--url',
        `${baseUrl}/v1/mcp`,
        '--token',
        w.agentToken,
      ],
    });
    const client = new Client({ name: 'vitest-stdio', version: '0.0.1' }, { capabilities: {} });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThanOrEqual(20);
      const r = await client.callTool({
        name: 'agent.heartbeat',
        arguments: { status: 'idle' },
      });
      const parsed = JSON.parse((r.content as Array<{ text?: string }>)[0]?.text ?? '{}');
      expect(parsed.agent).toBe(w.agentName);
    } finally {
      await client.close();
    }
  }, 60_000);
});
