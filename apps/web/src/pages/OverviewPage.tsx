import { useOutletContext } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import type { ProjectStats } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { ActorChip, Card, ErrorText, SourceBadge, Spinner, timeAgo } from '../components/ui.js';

/** 项目总览：进度 + 人机负载 + agent 状态 + 7 日活跃 —— 给 PM（和未来的替身）看的驾驶舱 */
export function OverviewPage() {
  const { projectKey } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error } = useApi<ProjectStats>(`/v1/projects/${projectKey}/stats`);

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
          未指派 {data.workload.unassigned} 个 · 紫色 = agent / 灰色 = 人类
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
            共 {data.activity7d.total} 条 · WEB=网页 · API=token · MCP=agent · SYSTEM=审批代执行
          </span>
        </div>
      </Card>
    </div>
  );
}
