import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FileTextOutlined, WarningFilled } from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { ActorType } from '../api/types.js';
import {
  ActorChip,
  Card,
  EmptyState,
  ErrorText,
  Modal,
  Spinner,
  SuccessText,
  timeAgo,
} from '../components/ui.js';
import type { ProjectPageCtx } from './ProjectLayout.js';

interface HealthResp {
  project: string;
  score: number;
  grade: string;
  factors: Array<{
    code: string;
    label: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    detail: string;
    penalty: number;
  }>;
  avatars: Array<{ name: string; status: string; lastHeartbeatAt: string | null }>;
  agentReputations: Array<{
    name: string;
    displayName: string;
    status: string;
    lastHeartbeatAt: string | null;
    bugsFiled: number;
    bugsResolved: number;
    bugAcceptanceRate: number | null;
    activeIssues: number;
    completedIssues: number;
  }>;
}

interface ReportItem {
  id: string;
  kind: string;
  title: string;
  content: string;
  author: { name: string; displayName: string; type: ActorType };
  createdAt: string;
}

/** 监控中心（M5）：项目健康度（扣分项）、agent 靠谱分、替身状态与报告流。 */
export function MonitoringPage() {
  const { projectKey, reloadDetail } = useOutletContext<ProjectPageCtx>();
  const health = useApi<HealthResp>(`/v1/projects/${projectKey}/health`);
  const reports = useApi<{ reports: ReportItem[] }>(`/v1/projects/${projectKey}/reports`);
  const [openReport, setOpenReport] = useState<ReportItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);
  const action = useAction();
  const [form, setForm] = useState({ name: '', description: '' });

  const sevDot = { HIGH: 'bg-red-500', MEDIUM: 'bg-orange-400', LOW: 'bg-amber-300' } as const;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 健康度 */}
        <Card className="flex items-center gap-4 p-4">
          {health.data ? (
            <>
              <ScoreRing score={health.data.score} grade={health.data.grade} />
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-700">项目健康度</h3>
                <p className="mt-1 text-xs text-slate-400">
                  {health.data.factors.length === 0
                    ? '各维度正常，满分 100'
                    : `有 ${health.data.factors.length} 项在扣分`}
                </p>
                <div className="mt-1 space-y-1">
                  {health.data.factors.slice(0, 4).map((f) => (
                    <div key={f.code} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sevDot[f.severity]}`} />
                      <span className="truncate" title={f.detail}>
                        {f.label} −{f.penalty}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Spinner />
          )}
        </Card>

        {/* 替身状态 + 创建 */}
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">PM 替身</h3>
            <button
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
              onClick={() => setCreating(true)}
            >
              + 创建替身
            </button>
          </div>
          <div className="space-y-1.5">
            {(health.data?.avatars ?? []).map((a) => (
              <div
                key={a.name}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm"
              >
                <span
                  className={`h-2 w-2 rounded-full ${a.status === 'active' ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`}
                />
                <span className="font-medium text-slate-700">{a.name}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {a.lastHeartbeatAt ? `巡检 ${timeAgo(a.lastHeartbeatAt)}` : '未运行'}
                </span>
              </div>
            ))}
            {(health.data?.avatars ?? []).length === 0 && (
              <p className="text-xs text-slate-300">
                还没有替身——创建后把它加入项目（AGENT 角色），再运行 avatar-worker
                即可自动产出日报与告警
              </p>
            )}
          </div>
          {health.error && <ErrorText>{health.error}</ErrorText>}
        </Card>

        {/* agent 靠谱分 */}
        <Card className="p-4">
          <h3 className="mb-2 font-semibold text-slate-700">Agent 靠谱分</h3>
          <div className="max-h-44 space-y-1.5 overflow-y-auto">
            {(health.data?.agentReputations ?? []).map((a) => (
              <div
                key={a.name}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
              >
                <ActorChip name={a.name} type="AGENT" />
                <span className="text-slate-500">
                  bug 被采纳率{' '}
                  <b className={rateColor(a.bugAcceptanceRate)}>
                    {a.bugAcceptanceRate === null ? '—' : `${a.bugAcceptanceRate}%`}
                  </b>
                  <span className="text-slate-400">
                    （{a.bugsResolved}/{a.bugsFiled}）
                  </span>
                </span>
                <span className="text-slate-500">
                  完成 {a.completedIssues} · 在办 {a.activeIssues}
                </span>
                <span className="ml-auto text-slate-400">
                  {a.lastHeartbeatAt ? timeAgo(a.lastHeartbeatAt) : '无心跳'}
                </span>
              </div>
            ))}
            {(health.data?.agentReputations ?? []).length === 0 && (
              <p className="text-xs text-slate-300">项目里还没有 agent</p>
            )}
          </div>
        </Card>
      </div>

      {/* 扣分明细 */}
      {health.data && health.data.factors.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold text-slate-700">扣分明细（哪里丢了分）</h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {health.data.factors.map((f) => (
              <div
                key={f.code}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${sevDot[f.severity]}`} />
                <span className="font-medium text-slate-700">{f.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{f.detail}</span>
                <span className="shrink-0 text-xs font-bold text-red-400">−{f.penalty}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 报告流 */}
      <Card className="p-4">
        <h3 className="mb-2 font-semibold text-slate-700">替身报告</h3>
        {reports.loading && <Spinner />}
        {reports.data && reports.data.reports.length === 0 && (
          <EmptyState>还没有报告——替身 worker 巡检后会在这里产出日报与风险告警</EmptyState>
        )}
        <div className="space-y-2">
          {reports.data?.reports.map((r) => (
            <div
              key={r.id}
              onClick={() => setOpenReport(r)}
              className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-indigo-200 hover:shadow-sm"
            >
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                  r.kind === 'RISK_ALERT'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                {r.kind === 'RISK_ALERT' ? <WarningFilled aria-hidden /> : <FileTextOutlined aria-hidden />}
                {r.kind === 'RISK_ALERT' ? '告警' : '日报'}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{r.title}</span>
              <ActorChip name={r.author.name} type={r.author.type} />
              <span className="text-xs text-slate-400">{timeAgo(r.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 创建替身 */}
      {creating && (
        <Modal title="创建 PM 替身（AVATAR）" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
              placeholder="替身名称（如 pm-avatar）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="职责描述（如：每日巡检进度与风险）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-400">
              创建后：① 复制 token；② 把替身加入本项目；③ 在 .env 配置 AVATAR_TOKEN 并运行
              <code className="mx-1 rounded bg-slate-100 px-1">
                pnpm --filter @agentpm/avatar-worker once
              </code>
            </p>
            {action.error && <ErrorText>{action.error}</ErrorText>}
            <button
              disabled={!form.name.trim() || !form.description.trim() || action.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={async () => {
                const r = await action.run(() =>
                  api.post<{ agent: { name: string }; token: string }>('/v1/agents', {
                    name: form.name,
                    actorType: 'AVATAR',
                    description: form.description,
                  }),
                );
                if (r) {
                  setMinted({ name: r.agent.name, token: r.token });
                  setCreating(false);
                  // 顺手加入项目（AGENT 角色）
                  await api
                    .post(`/v1/projects/${projectKey}/members`, {
                      actorName: r.agent.name,
                      role: 'AGENT',
                    })
                    .catch(() => {});
                  health.reload();
                  reloadDetail();
                }
              }}
            >
              创建并加入本项目
            </button>
          </div>
        </Modal>
      )}

      {minted && (
        <Modal
          title={`替身 ${minted.name} 的 token（仅此一次）`}
          onClose={() => setMinted(null)}
          wide
        >
          <SuccessText>运行 worker 需要它：.env 里设置 AVATAR_TOKEN=以下值</SuccessText>
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">
            {minted.token}
          </pre>
          <button
            className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() =>
              void navigator.clipboard.writeText(minted.token).then(() => setMinted(null))
            }
          >
            复制并关闭
          </button>
        </Modal>
      )}

      {openReport && (
        <Modal title={openReport.title} onClose={() => setOpenReport(null)} wide>
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
            <ActorChip name={openReport.author.name} type={openReport.author.type} />
            {new Date(openReport.createdAt).toLocaleString('zh-CN')}
          </div>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
            {openReport.content}
          </pre>
        </Modal>
      )}
    </div>
  );
}

function rateColor(rate: number | null): string {
  if (rate === null) return 'text-slate-400';
  if (rate >= 70) return 'text-emerald-600';
  if (rate >= 40) return 'text-amber-600';
  return 'text-red-500';
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const filled = (score / 100) * C;
  const color =
    score >= 90 ? '#10b981' : score >= 75 ? '#6366f1' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <svg
      viewBox="0 0 88 88"
      className="h-22 w-22 shrink-0"
      role="img"
      aria-label={`健康度 ${score}`}
    >
      <circle cx="44" cy="44" r={R} fill="none" stroke="#e2e8f0" strokeWidth="9" />
      <circle
        cx="44"
        cy="44"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${C}`}
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="42" textAnchor="middle" fontSize="20" fontWeight="700" fill="#334155">
        {score}
      </text>
      <text x="44" y="58" textAnchor="middle" fontSize="10" fill="#94a3b8">
        等级 {grade}
      </text>
    </svg>
  );
}
