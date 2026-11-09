import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeInsights, type SnapshotInput } from '#worker/analysis.js';
import { createWorld, disposeWorld, type TestWorld } from './helpers.js';
import { runOnce } from '#worker/run.js';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
  await w.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await disposeWorld(w);
});

/* ---------------- 纯函数：规则引擎 ---------------- */

const baseSnapshot = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  projectKey: 'T',
  projectName: '测试',
  stats: {
    totals: { total: 5, done: 2, todo: 2, inProgress: 1, completionRate: 40 },
    workload: { unassigned: 1, members: [{ name: 'a', type: 'HUMAN', open: 2, inProgress: 1 }] },
    agents: [
      { name: 'bot', status: 'active', lastHeartbeatAt: new Date().toISOString(), activeIssues: 1 },
    ],
    sprint: {
      name: 'S1',
      endsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
      totals: { TODO: 2, IN_PROGRESS: 1, DONE: 2, total: 5 },
    },
    activity7d: { total: 10, bySource: { WEB: 4, MCP: 6, API: 0, SYSTEM: 0 } },
  },
  issues: [],
  burndownTail: [{ date: '2026-11-09', remaining: 3, ideal: 2 }],
  pendingApprovals: [],
  policy: { stallDays: 3, digestHour: 20, commentOnStalled: false },
  now: new Date('2026-11-09T12:00:00Z'),
  ...over,
});

describe('M5 · 规则引擎（纯函数）', () => {
  it('停滞任务：IN_PROGRESS 且超 stallDays 无更新', () => {
    const old = new Date('2026-11-01T00:00:00Z').toISOString();
    const r = computeInsights(
      baseSnapshot({
        issues: [
          {
            issueKey: 'T-1',
            title: 'x',
            type: 'TASK',
            state: '进行中',
            stateCategory: 'IN_PROGRESS',
            priority: 'P2',
            assignee: 'a',
            dueDate: null,
            updatedAt: old,
          },
        ],
      }),
    );
    expect(r.risks.some((x) => x.code === 'STALLED_TASK')).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('逾期 + Sprint 偏离 + 审批积压 + agent 失联组合识别', () => {
    const r = computeInsights(
      baseSnapshot({
        issues: [
          {
            issueKey: 'T-2',
            title: '逾期',
            type: 'TASK',
            state: '待办',
            stateCategory: 'TODO',
            priority: 'P1',
            assignee: null,
            dueDate: '2026-11-05T00:00:00Z',
            updatedAt: new Date().toISOString(),
          },
        ],
        burndownTail: [{ date: '2026-11-09', remaining: 4, ideal: 1 }],
        pendingApprovals: [
          {
            id: 'p1',
            actionType: 'issue.transition',
            requestedBy: 'bot',
            createdAt: '2026-11-07T00:00:00Z',
          },
        ],
        stats: {
          ...baseSnapshot().stats,
          agents: [{ name: 'bot', status: 'active', lastHeartbeatAt: null, activeIssues: 2 }],
        },
      }),
    );
    const codes = r.risks.map((x) => x.code);
    expect(codes).toContain('OVERDUE');
    expect(codes).toContain('SPRINT_BEHIND');
    expect(codes).toContain('APPROVAL_AGING');
    expect(codes).toContain('AGENT_SILENT');
  });

  it('健康快照无风险时 risks 为空', () => {
    const r = computeInsights(
      baseSnapshot({
        burndownTail: [{ date: '2026-11-09', remaining: 1, ideal: 2 }],
        stats: {
          ...baseSnapshot().stats,
          sprint: null,
          agents: [
            {
              name: 'bot',
              status: 'active',
              lastHeartbeatAt: new Date().toISOString(),
              activeIssues: 0,
            },
          ],
        },
      }),
    );
    expect(r.risks).toHaveLength(0);
    expect(r.headline).toContain('40%');
  });
});

/* ---------------- 集成：替身工作循环（真实 HTTP） ---------------- */

describe('M5 · 替身 runOnce（REST 全链路）', () => {
  it('创建 AVATAR → 加入项目 → runOnce 产出日报 → owner 收到通知', async () => {
    // 造一个逾期任务，让风险非空
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/issues`,
      headers: { cookie: w.adminCookie },
      payload: {
        type: 'TASK',
        title: '逾期任务',
        dueDate: new Date(Date.now() - 2 * 86400_000).toISOString(),
      },
    });

    const avatar = await w.app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { cookie: w.adminCookie },
      payload: {
        name: `avatar-${Math.random().toString(36).slice(2, 8)}`,
        actorType: 'AVATAR',
        description: '测试替身',
      },
    });
    expect(avatar.statusCode).toBe(201);
    expect(avatar.json().agent).toBeTruthy();
    const token = avatar.json().token as string;
    await w.app.inject({
      method: 'POST',
      url: `/v1/projects/${w.projectKey}/members`,
      headers: { cookie: w.adminCookie },
      payload: { actorName: avatar.json().agent.name, role: 'AGENT' },
    });

    const baseUrl = `http://127.0.0.1:${(w.app.server.address() as { port: number }).port}`;
    // 用 UTC 锚定时间（而非本地 setHours），避免测试在本地午夜后运行时 UTC 日期错位：
    // 首跑有 OVERDUE 新风险 → 告警/日报均可
    const result = await runOnce({
      apiUrl: baseUrl,
      token,
      now: new Date(new Date().setUTCHours(21, 0, 0, 0)),
    });
    const p = result.projects.find((x) => x.key === w.projectKey)!;
    expect(['digest', 'alert']).toContain(p.action);
    expect(p.risks).toBeGreaterThanOrEqual(1);

    // 报告已入库且作者为替身
    const reports = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/reports`,
      headers: { cookie: w.adminCookie },
    });
    const items = reports.json().reports as Array<{
      kind: string;
      author: { name: string; type: string };
      content: string;
    }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.author.type).toBe('AVATAR');
    expect(items[0]!.content).toContain('替身');
    expect(items[0]!.content).toContain('逾期');

    // owner（admin）收到通知
    const notif = await w.db.notification.findFirst({
      where: { recipient: { name: 'admin' }, type: 'report.published' },
    });
    expect(notif).not.toBeNull();

    // 同日再跑 → 无新增风险不再告警；且（UTC+8 下本地 6 点）未到日报时点 → 跳过
    const again = await runOnce({
      apiUrl: baseUrl,
      token,
      now: new Date(new Date().setUTCHours(22, 0, 0, 0)),
    });
    const p2 = again.projects.find((x) => x.key === w.projectKey)!;
    expect(p2.action === 'skipped' || p2.action === 'alert').toBe(true);
  });

  it('非 AVATAR token 拒绝运行', async () => {
    const baseUrl = `http://127.0.0.1:${(w.app.server.address() as { port: number }).port}`;
    await expect(runOnce({ apiUrl: baseUrl, token: w.agentToken })).rejects.toThrow(/AVATAR/);
  });
});

describe('M5 · 健康度与信誉分', () => {
  it('GET /health 返回评分/因子/agent 信誉', async () => {
    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/projects/${w.projectKey}/health`,
      headers: { cookie: w.adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBeLessThanOrEqual(100);
    expect(body.factors.some((f: { code: string }) => f.code === 'OVERDUE')).toBe(true);
    expect(Array.isArray(body.agentReputations)).toBe(true);
    const rep = body.agentReputations.find((a: { name: string }) => a.name === w.agentName);
    expect(rep).toBeTruthy();
    expect(typeof rep.activeIssues).toBe('number');
  });
});
