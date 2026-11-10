import { useOutletContext } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import type { AgileReport, ProjectStats } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { CfdChart, CycleTimeChart, VelocityBars } from '../components/charts.js';
import { ActorChip, Card, ErrorText, SourceBadge, Spinner, timeAgo } from '../components/ui.js';

/** 项目总览：进度 + 人机负载 + agent 状态 + 7 日活跃 + 敏捷报表 —— 给 PM（和未来的替身）看的驾驶舱 */
export function OverviewPage() {
  const { projectKey } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error } = useApi<ProjectStats>(`/v1/projects/${projectKey}/stats`);
  const agile = useApi<AgileReport>(`/v1/projects/${projectKey}/reports/agile`);
  const velocity = useApi<{ items: Array<{ name: string; done: number; total: number }> }>(
    `/v1/projects/${projectKey}/velocity`,
  );

  if (loading) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return null;

  const maxLoad = Math.max(1, ...data.workload.members.map((m) => m.open + m.inProgress));

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      {/* 进度 */}
      <Card className="p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">整体进度</h2>
          {data.sprint && (
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
              {data.sprint.name} · {data.sprint.totals.DONE}/{data.sprint.totals.total} 完成
              {data.sprint.endsAt
                ? ` · 止于 ${new Date(data.sprint.endsAt).toLocaleDateString('zh-CN')}`
                : ''}
            </span>
          )}
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all"
            style={{ width: `${data.totals.completionRate}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-center text-sm">
          {[
            ['总 issue', data.totals.total, 'text-slate-700'],
            ['待办', data.totals.todo, 'text-slate-500'],
            ['进行中', data.totals.inProgress, 'text-indigo-600'],
            ['已完成', data.totals.done, 'text-emerald-600'],
          ].map(([label, v, cls]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 py-2">
              <div className={`text-xl font-bold ${cls}`}>{v as number}</div>
              <div className="text-xs text-slate-400">{label as string}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 负载分布：人机分色 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-700">负载分布（未完成）</h2>
        <p className="text-xs text-slate-400">
          未指派 {data.workload.unassigned} 个 · 紫色 = 独立机器人 / 灰色 = 人类成员
        </p>
        <div className="mt-3 space-y-2">
          {data.workload.members.map((m) => {
            const total = m.open + m.inProgress;
            const isAgent = m.type !== 'HUMAN';
            return (
              <div key={m.name} className="flex items-center gap-2 text-sm">
                <ActorChip name={m.name} type={m.type} />
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${isAgent ? 'bg-violet-400' : 'bg-slate-400'}`}
                    style={{ width: `${(total / maxLoad) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-right text-xs text-slate-500">
                  {m.inProgress} 进行 · {m.open} 待办
                </span>
              </div>
            );
          })}
          {data.workload.members.length === 0 && (
            <p className="text-xs text-slate-300">暂无已指派任务</p>
          )}
        </div>
      </Card>

      {/* agent 状态 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-700">Agent 状态</h2>
        <div className="mt-3 space-y-2">
          {data.agents.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <span
                className={`h-2 w-2 rounded-full ${a.status === 'active' ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`}
              />
              <span className="font-medium text-slate-700">{a.name}</span>
              <span className="rounded bg-violet-100 px-1.5 text-[11px] text-violet-700">
                {a.activeIssues} 个在办
              </span>
              <span className="ml-auto text-xs text-slate-400">
                {a.lastHeartbeatAt ? `心跳 ${timeAgo(a.lastHeartbeatAt)}` : '从未心跳'}
              </span>
            </div>
          ))}
          {data.agents.length === 0 && (
            <p className="text-xs text-slate-300">项目里还没有 agent 成员——去 Agent 页创建并加入</p>
          )}
        </div>
      </Card>

      {/* 7 日活跃 */}
      <Card className="p-4 lg:col-span-2">
        <h2 className="font-semibold text-slate-700">7 日活跃度（按来源）</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {Object.entries(data.activity7d.bySource).map(([source, count]) => (
            <div key={source} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <SourceBadge source={source as never} />
              <span className="text-lg font-bold text-slate-700">{count}</span>
            </div>
          ))}
          <span className="ml-auto text-sm text-slate-500">
            共 {data.activity7d.total} 条 · WEB=网页手动 · API/MCP=token 自动化 · SYSTEM=审批代执行
          </span>
        </div>
      </Card>

      {/* 敏捷报表（M6） */}
      <Card className="p-4 lg:col-span-2">
        <h2 className="font-semibold text-slate-700">敏捷报表</h2>
        <p className="text-xs text-slate-400">
          从活动流回放：周期时间（进入进行中→完成的天数）、累积流（逐日待办/进行中/完成）、Epic 进度
        </p>
        {agile.loading && <Spinner />}
        {agile.error && <ErrorText>{agile.error}</ErrorText>}
        {agile.data && (
          <div className="mt-3 grid gap-5">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-slate-500">
                周期时间（{agile.data.cycleTimes.length} 个已完成 · 越低越快）
              </h3>
              <CycleTimeChart data={agile.data.cycleTimes} />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-slate-500">
                累积流（面积带 = 各状态 issue 数）
              </h3>
              <CfdChart data={agile.data.cfd} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-slate-500">Epic 进度</h3>
                {agile.data.epics.length === 0 && (
                  <p className="text-xs text-slate-300">还没有 Epic</p>
                )}
                <div className="space-y-2">
                  {agile.data.epics.map((e) => (
                    <div key={e.key} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-400">{e.key}</span>
                        <span className="flex-1 truncate text-slate-600">{e.title}</span>
                        <span className="text-xs text-slate-400">
                          {e.done}/{e.total}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{
                            width: `${e.total > 0 ? Math.round((e.done / e.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-slate-500">
                  速率趋势（近几个 Sprint）
                </h3>
                <VelocityBars items={velocity.data?.items ?? []} />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
