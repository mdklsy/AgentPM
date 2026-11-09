import type { LlmAdapter } from '@agentpm/llm-adapter';
import { computeInsights, type SnapshotInput } from './analysis.js';
import { renderReport } from './report-render.js';

/**
 * 替身执行循环（ADR 0005）：采集（REST）→ 规则分析 → LLM 增强（可选）→ 报告/提醒。
 * 只经 REST API 干活：每个请求带 Bearer token，动作全部进审计（source=API，actor=avatar）。
 */

interface Fetcher {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

function makeFetcher(apiUrl: string, token: string): Fetcher {
  const base = apiUrl.replace(/\/$/, '');
  const req = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok)
      throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? ''}`);
    return json as T;
  };
  return { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b) };
}

export interface RunOptions {
  apiUrl: string;
  token: string;
  llm?: LlmAdapter | null;
  now?: Date;
  /** 限制只处理该项目（测试/定向巡检用） */
  projectKey?: string;
  log?: (msg: string) => void;
}

export interface RunResult {
  avatar: string;
  projects: Array<{
    key: string;
    action: 'digest' | 'alert' | 'skipped';
    reason?: string;
    reportId?: string;
    risks: number;
  }>;
}

export async function runOnce(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const api = makeFetcher(opts.apiUrl, opts.token);
  const now = opts.now ?? new Date();

  const me = await api.get<{ actor: { name: string; type: string } }>('/v1/auth/me');
  if (me.actor.type !== 'AVATAR') {
    throw new Error(`token 属于 ${me.actor.type}，替身 worker 需要 AVATAR 类型账号的 token`);
  }
  const avatarName = me.actor.name;

  // 心跳：让监控面板知道替身活着
  await api.post('/v1/agents/heartbeat', { status: 'active' }).catch(() => {});

  const { projects } = await api.get<{ projects: Array<{ key: string; name: string }> }>(
    '/v1/projects',
  );
  const result: RunResult['projects'] = [];

  for (const p of projects) {
    if (opts.projectKey && p.key !== opts.projectKey) continue;
    try {
      result.push(await processProject(api, p.key, p.name, avatarName, opts.llm ?? null, now, log));
    } catch (e) {
      log(`[${p.key}] 处理失败：${(e as Error).message}`);
      result.push({ key: p.key, action: 'skipped', reason: (e as Error).message, risks: 0 });
    }
  }
  return { avatar: avatarName, projects: result };
}

async function processProject(
  api: Fetcher,
  projectKey: string,
  projectName: string,
  avatarName: string,
  llm: LlmAdapter | null,
  now: Date,
  log: (m: string) => void,
): Promise<RunResult['projects'][number]> {
  // 采集（无权限/非成员会 403，跳过）
  const detail = await api.get<{
    project: {
      settings: {
        avatarPolicy?: Partial<{
          digestHour: number;
          stallDays: number;
          commentOnStalled: boolean;
        }>;
      };
    };
  }>(`/v1/projects/${projectKey}`);
  const policy = {
    digestHour: detail.project.settings?.avatarPolicy?.digestHour ?? 20,
    stallDays: detail.project.settings?.avatarPolicy?.stallDays ?? 3,
    commentOnStalled: detail.project.settings?.avatarPolicy?.commentOnStalled ?? false,
  };

  const [stats, issuesResp, approvalsResp, sprintResp, reportsResp] = await Promise.all([
    api.get<SnapshotInput['stats']>(`/v1/projects/${projectKey}/stats`),
    api.get<{ items: SnapshotInput['issues'] }>(
      `/v1/projects/${projectKey}/issues?pageSize=100&sort=updated_desc`,
    ),
    api.get<{
      approvals: Array<{ id: string; actionType: string; requestedBy: string; createdAt: string }>;
    }>(`/v1/projects/${projectKey}/approvals?status=PENDING`),
    api.get<{ sprint: { id: string; name: string } | null }>(
      `/v1/projects/${projectKey}/sprints/current`,
    ),
    api.get<{
      reports: Array<{
        kind: string;
        createdAt: string;
        data: { insights?: { risks: Array<{ code: string }> } };
      }>;
    }>(`/v1/projects/${projectKey}/reports?limit=1`),
  ]);

  let burndownTail: SnapshotInput['burndownTail'] = null;
  if (sprintResp.sprint) {
    const bd = await api
      .get<{ points: Array<{ date: string; remaining: number; ideal: number }> }>(
        `/v1/projects/${projectKey}/sprints/${sprintResp.sprint.id}/burndown`,
      )
      .catch(() => null);
    burndownTail = bd ? bd.points.slice(-3) : null;
  }

  const snapshot: SnapshotInput = {
    projectKey,
    projectName,
    stats,
    issues: issuesResp.items,
    burndownTail,
    pendingApprovals: approvalsResp.approvals,
    policy,
    now,
  };
  const insights = computeInsights(snapshot);

  // LLM 叙述增强（可选；失败静默降级）
  let llmOut: { summary?: string; keyRisks?: string[]; suggestions?: string[] } | null = null;
  if (llm) {
    llmOut = await llm.completeJson<{
      summary?: string;
      keyRisks?: string[];
      suggestions?: string[];
    }>({
      system:
        '你是项目管理 PM 助手。基于结构化项目快照输出简明中文洞察。只返回 JSON：{"summary":"一段总体判断(<=120字)","keyRisks":["补充风险视角(最多3条)"],"suggestions":["建议(最多3条)"]}。不要虚构数据。',
      prompt: `项目快照：${JSON.stringify({ headline: insights.headline, risks: insights.risks, totals: stats.totals, sprint: stats.sprint })}`,
      maxTokens: 600,
    });
  }

  // 报告决策：
  // - 高/中危且与上一份报告的风险集合不同 → 立即 RISK_ALERT
  // - 到达 digestHour 且今日尚无日报 → DAILY_DIGEST
  const last = reportsResp.reports[0];
  const lastRiskCodes = new Set(last?.data?.insights?.risks?.map((r) => r.code) ?? []);
  const serious = insights.risks.filter((r) => r.severity !== 'LOW');
  const newSerious = serious.filter((r) => !lastRiskCodes.has(r.code));
  const today = now.toISOString().slice(0, 10);
  // 当日已发过任何报告（日报或告警）即不再补发日报——防打扰；新风险仍会即时告警
  const digestToday = reportsResp.reports.some((r) => r.createdAt.slice(0, 10) === today);

  let action: 'digest' | 'alert' | 'skipped' = 'skipped';
  let reason: string | undefined;
  let reportId: string | undefined;

  if (newSerious.length > 0) {
    action = 'alert';
  } else if (!digestToday && now.getHours() >= policy.digestHour) {
    action = 'digest';
  } else {
    reason = digestToday ? '今日报告已产出' : `无新增风险；未到日报时点（${policy.digestHour}:00）`;
  }

  if (action !== 'skipped') {
    const rendered = renderReport({
      projectName,
      kind: action === 'alert' ? 'RISK_ALERT' : 'DAILY_DIGEST',
      insights,
      llm: llmOut,
      window: {
        from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
        to: now.toISOString(),
      },
      avatarName,
      engine: llm ? 'rules+llm' : 'rules',
    });
    const created = await api.post<{ report: { id: string } }>(
      `/v1/projects/${projectKey}/reports`,
      {
        kind: action === 'alert' ? 'RISK_ALERT' : 'DAILY_DIGEST',
        title: rendered.title,
        content: rendered.content,
        data: { insights, llm: llmOut, policy },
      },
    );
    reportId = created.report.id;
    log(`[${projectKey}] 发布${action === 'alert' ? '风险告警' : '日报'}：${rendered.title}`);

    // 可选：停滞任务评论提醒（策略显式开启才会做，最多 3 条）
    if (policy.commentOnStalled) {
      const stalled = insights.risks.find((r) => r.code === 'STALLED_TASK');
      const list = (stalled?.evidence?.issues as Array<{ issueKey: string }> | undefined) ?? [];
      for (const s of list.slice(0, 3)) {
        await api
          .post(`/v1/issues/${s.issueKey}/comments`, {
            body: `替身提醒：该任务已超过 ${policy.stallDays} 天无更新，请确认是否被阻塞。`,
          })
          .catch(() => {});
      }
    }
  } else {
    log(`[${projectKey}] 跳过（${reason}）`);
  }

  return { key: projectKey, action, reason, reportId, risks: insights.risks.length };
}
