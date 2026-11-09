/**
 * AgentPM MCP 端到端冒烟（pnpm smoke:mcp）：
 * 1. 内嵌启动 API（随机端口，用 DATABASE_URL 指向的库）；
 * 2. REST 引导：登录 admin → 建项目 SMOKE → 签发 agent token；
 * 3. 官方 SDK client 走 Streamable HTTP：initialize/listTools/claim/progress/bug/regression/stats；
 * 4. stdio 网关再走一遍 initialize/listTools/heartbeat；
 * 5. 清理冒烟数据（项目级联删除）。
 * 退出码 0 = 全部通过。
 */
import { createRequire } from 'node:module';
import { loadEnv } from '@agentpm/shared/node';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

loadEnv();

const require_ = createRequire(import.meta.url);
const { buildApp } = await import('../src/app.js');
const { createPrisma } = await import('@agentpm/db');

const db = createPrisma(process.env.DATABASE_URL);
const SMOKE_KEY = 'SMOKE';
let failures = 0;

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.info(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

const app = await buildApp({ prisma: db });
await app.listen({ port: 0, host: '127.0.0.1' });
const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
console.info(`\n[smoke] API 起于 ${url}\n`);

try {
  /* ---------------- REST 引导 ---------------- */
  const admin = await db.actor.findFirst({ where: { type: 'HUMAN', isAdmin: true } });
  if (!admin) throw new Error('数据库中没有管理员账号，请先 pnpm seed');

  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      username: admin.name,
      password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!AgentPM2026',
    },
  });
  if (login.statusCode !== 200)
    throw new Error(`admin 登录失败（${login.statusCode}）：${login.body}`);
  const setCookie = login.headers['set-cookie'];
  const cookieList = Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie)];
  const cookie =
    cookieList.find((c) => c.startsWith('agentpm_session='))?.split(';')[0] ??
    cookieList[0]!.split(';')[0]!;

  // 清掉旧冒烟项目（幂等）
  await db.project.deleteMany({ where: { key: SMOKE_KEY } });
  const proj = await app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { cookie },
    payload: { key: SMOKE_KEY, name: 'MCP 冒烟项目' },
  });
  ok('REST 建项目', proj.statusCode === 201, proj.body);

  const agentRes = await app.inject({
    method: 'POST',
    url: '/v1/agents',
    headers: { cookie },
    payload: { name: 'smoke-agent', description: '冒烟 agent' },
  });
  const token = agentRes.json().token as string;
  ok('签发 agent token', !!token);
  await app.inject({
    method: 'POST',
    url: `/v1/projects/${SMOKE_KEY}/members`,
    headers: { cookie },
    payload: { actorName: 'smoke-agent', role: 'AGENT' },
  });
  for (const t of ['冒烟任务一', '冒烟任务二']) {
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${SMOKE_KEY}/issues`,
      headers: { cookie },
      payload: { type: 'TASK', title: t, labelNames: ['smoke'] },
    });
  }

  /* ---------------- HTTP MCP ---------------- */
  console.info('\n[smoke] Streamable HTTP:');
  const transport = new StreamableHTTPClientTransport(new URL('/v1/mcp', url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'smoke', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  ok('initialize + tools/list', tools.tools.length >= 20, `got ${tools.tools.length}`);

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`tool ${name} failed: ${JSON.stringify(r.content)}`);
    return JSON.parse((r.content as Array<{ text?: string }>)[0]?.text ?? '{}');
  };

  const claim = await call('issue.claim', { projectKey: SMOKE_KEY, label: 'smoke' });
  ok('issue.claim 抢单', claim.issue?.assignee === 'smoke-agent');

  const prog = await call('progress.report', {
    issueKey: claim.issue.issueKey,
    percent: 70,
    notes: 'smoke 进度',
  });
  ok('progress.report', prog.percent === 70);

  const bug = await call('bug.report', {
    projectKey: SMOKE_KEY,
    title: 'smoke 缺陷',
    fingerprint: 'smoke:fp',
  });
  ok('bug.report', bug.status === 'created');

  const dup = await call('bug.report', {
    projectKey: SMOKE_KEY,
    title: 'smoke 缺陷（重报）',
    fingerprint: 'smoke:fp',
  });
  ok('bug 指纹去重', dup.status === 'deduplicated' && dup.duplicateOf === bug.issue.issueKey);

  const reg = await call('regression.submit', {
    projectKey: SMOKE_KEY,
    suite: 'smoke-suite',
    results: [
      { name: 'ok.case', status: 'PASS' },
      { name: 'bad.case', status: 'FAIL', fingerprint: 'smoke:fp2' },
    ],
  });
  ok(
    'regression.submit + 自动建单',
    reg.status === 'FAILED' && reg.filedBugs[0]?.status === 'created',
  );

  const stats = await call('project.stats', { projectKey: SMOKE_KEY });
  ok('project.stats', stats.totals?.total >= 3);

  const activity = await call('project.activity', {
    projectKey: SMOKE_KEY,
    source: 'MCP',
    limit: 50,
  });
  ok(
    'MCP 全量审计',
    [
      'task.claimed',
      'progress.reported',
      'bug.created' as never,
      'bug.deduplicated',
      'regression.submitted',
    ].every((a) =>
      activity.items.some(
        (x: { action: string }) => x.action === a || x.action === 'issue.created',
      ),
    ),
  );
  await client.close();

  /* ---------------- stdio 网关 ---------------- */
  console.info('\n[smoke] stdio 网关:');
  // Node ≥ 23 原生支持类型剥离，直接以 node 运行网关 TS 源码
  const stdio = new StdioClientTransport({
    command: process.execPath,
    args: [
      require_.resolve('../../mcp-stdio/src/main.ts'),
      '--url',
      `${url}/v1/mcp`,
      '--token',
      token,
    ],
  });
  const sClient = new Client({ name: 'smoke-stdio', version: '0.0.1' }, { capabilities: {} });
  await sClient.connect(stdio);
  const sTools = await sClient.listTools();
  ok('stdio initialize + tools/list', sTools.tools.length >= 20);
  const hb = await sClient.callTool({ name: 'agent.heartbeat', arguments: { status: 'idle' } });
  ok(
    'stdio agent.heartbeat',
    JSON.parse((hb.content as Array<{ text?: string }>)[0]!.text).agent === 'smoke-agent',
  );
  await sClient.close();

  /* ---------------- 清理 ---------------- */
  await db.project.deleteMany({ where: { key: SMOKE_KEY } });
  await db.actor.deleteMany({ where: { name: 'smoke-agent' } });
  console.info('\n[smoke] 冒烟数据已清理');
} finally {
  await app.close();
}

console.info(failures === 0 ? '\n[smoke] ✅ 全部通过\n' : `\n[smoke] ❌ ${failures} 项失败\n`);
process.exit(failures === 0 ? 0 : 1);
