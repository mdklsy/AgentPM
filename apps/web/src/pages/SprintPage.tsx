import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AimOutlined, CaretRightOutlined, CheckOutlined, RollbackOutlined } from '@ant-design/icons';
import { api, qs } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { BurndownPoint, IssueListItem } from '../api/types.js';
import { BurndownChart, VelocityBars } from '../components/charts.js';
import {
  Card,
  EmptyState,
  ErrorText,
  Modal,
  PriorityBadge,
  Spinner,
  SuccessText,
  TypeBadge,
} from '../components/ui.js';
import type { ProjectPageCtx } from './ProjectLayout.js';

interface SprintItem {
  id: string;
  name: string;
  goal: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  issueCount: number;
}

interface BurndownResp {
  sprint: { id: string; name: string; status: string };
  total: number;
  scopeNote?: string;
  points: BurndownPoint[];
}

/** Sprint 面板：排期管理 + 燃尽图 + 速率。 */
export function SprintPage() {
  const { projectKey, openIssue } = useOutletContext<ProjectPageCtx>();
  const sprintsApi = useApi<{ sprints: SprintItem[] }>(`/v1/projects/${projectKey}/sprints`);
  const backlogApi = useApi<{
    backlog: Array<{
      issueKey: string;
      title: string;
      type: string;
      priority: string;
      assignee: string | null;
    }>;
  }>(`/v1/projects/${projectKey}/backlog`);
  const sprintIssuesApi = useApi<{ items: IssueListItem[] }>(
    `/v1/projects/${projectKey}/issues${qs({ pageSize: 100, sort: 'priority_asc' })}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active =
    sprintsApi.data?.sprints.find((s) => s.id === selected) ??
    sprintsApi.data?.sprints.find((s) => s.status === 'ACTIVE') ??
    sprintsApi.data?.sprints[0];
  const burndownApi = useApi<BurndownResp>(
    active ? `/v1/projects/${projectKey}/sprints/${active.id}/burndown` : null,
  );
  const velocityApi = useApi<{ items: Array<{ name: string; done: number; total: number }> }>(
    `/v1/projects/${projectKey}/velocity`,
  );
  const [creating, setCreating] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const action = useAction();
  const [form, setForm] = useState({ name: '', goal: '', endsAt: '' });

  const reloadAll = () => {
    sprintsApi.reload();
    burndownApi.reload();
    velocityApi.reload();
    sprintIssuesApi.reload();
    backlogApi.reload();
  };

  const sprintIssues = (sprintIssuesApi.data?.items ?? []).filter(
    (i) => i.sprint?.id === active?.id,
  );
  const inSprintKeys = new Set(
    (sprintIssuesApi.data?.items ?? []).filter((i) => i.sprint).map((i) => i.issueKey),
  );
  const backlogItems = (backlogApi.data?.backlog ?? []).filter(
    (i) => !inSprintKeys.has(i.issueKey),
  );

  const statusChip = (s: SprintItem['status']) =>
    s === 'ACTIVE'
      ? 'bg-indigo-100 text-indigo-700'
      : s === 'PLANNED'
        ? 'bg-slate-100 text-slate-600'
        : 'bg-emerald-100 text-emerald-700';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Sprint 列表 + 操作 */}
      <div className="flex flex-wrap items-center gap-2">
        {sprintsApi.loading && <Spinner />}
        {sprintsApi.data?.sprints.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm transition ${
              active?.id === s.id
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusChip(s.status)}`}
            >
              {s.status}
            </span>
            <span className="font-medium text-slate-700">{s.name}</span>
            <span className="text-xs text-slate-400">{s.issueCount} 个</span>
          </button>
        ))}
        <button
          className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          + 新 Sprint
        </button>
      </div>
      {action.error && <ErrorText>{action.error}</ErrorText>}
      {action.message && <SuccessText>{action.message}</SuccessText>}

      {active ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold text-slate-800">{active.name}</h2>
              {active.goal && (
                <span className="flex items-center gap-1 text-sm text-slate-500">
                  <AimOutlined aria-hidden />
                  {active.goal}
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {active.status === 'PLANNED' && (
                  <button
                    className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                    onClick={async () => {
                      const ok = await action.run(
                        () =>
                          api.patch(`/v1/projects/${projectKey}/sprints/${active.id}/status`, {
                            status: 'ACTIVE',
                          }),
                        `${active.name} 已启动`,
                      );
                      if (ok !== undefined) reloadAll();
                    }}
                  >
                    <CaretRightOutlined aria-hidden /> 启动 Sprint
                  </button>
                )}
                {active.status === 'ACTIVE' && (
                  <button
                    className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setConfirmComplete(true)}
                  >
                    <CheckOutlined aria-hidden /> 完成 Sprint
                  </button>
                )}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {active.startsAt ? new Date(active.startsAt).toLocaleDateString('zh-CN') : '未开始'} ~{' '}
              {active.endsAt ? new Date(active.endsAt).toLocaleDateString('zh-CN') : '未设定结束日'}
            </div>
          </Card>

          {/* 燃尽图 */}
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="font-semibold text-slate-700">燃尽图</h3>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <span className="inline-block h-0.5 w-4 bg-indigo-600" /> 剩余
                <span className="ml-2 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-300" />{' '}
                理想
              </span>
              <span className="ml-auto text-xs text-slate-400">
                基于审计流逐日重建（含重开修正）
              </span>
            </div>
            {burndownApi.loading && <Spinner />}
            {burndownApi.data && (
              <>
                <BurndownChart points={burndownApi.data.points} total={burndownApi.data.total} />
                {burndownApi.data.scopeNote && (
                  <p className="text-xs text-slate-400">{burndownApi.data.scopeNote}</p>
                )}
              </>
            )}
          </Card>

          {/* 排期：Sprint 内 / Backlog 双栏 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 font-semibold text-slate-700">
                本 Sprint 内（{sprintIssues.length}）
              </h3>
              <div className="space-y-1.5">
                {sprintIssues.map((i) => (
                  <div
                    key={i.issueKey}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm"
                  >
                    <button
                      className="font-mono text-xs text-indigo-500"
                      onClick={() => openIssue(i.issueKey)}
                    >
                      {i.issueKey}
                    </button>
                    <TypeBadge type={i.type} />
                    <PriorityBadge priority={i.priority} />
                    <span className="flex-1 truncate">{i.title}</span>
                    {i.stateCategory === 'DONE' ? (
                      <span className="rounded bg-emerald-100 px-1.5 text-[11px] text-emerald-700">
                        完成
                      </span>
                    ) : (
                      <button
                        className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                        title="移回 Backlog"
                        onClick={async () => {
                          await action.run(() =>
                            api.post(`/v1/issues/${i.issueKey}/sprint`, { sprintId: null }),
                          );
                          reloadAll();
                        }}
                      >
                        <RollbackOutlined aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
                {sprintIssues.length === 0 && (
                  <p className="text-xs text-slate-300">空——从右侧 Backlog 排入</p>
                )}
              </div>
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 font-semibold text-slate-700">Backlog（可排入）</h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {backlogItems.map((i) => (
                  <div
                    key={i.issueKey}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm"
                  >
                    <button
                      className="font-mono text-xs text-indigo-500"
                      onClick={() => openIssue(i.issueKey)}
                    >
                      {i.issueKey}
                    </button>
                    <TypeBadge type={i.type as never} />
                    <span className="flex-1 truncate">{i.title}</span>
                    {active.status !== 'COMPLETED' && (
                      <button
                        className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                        onClick={async () => {
                          await action.run(() =>
                            api.post(`/v1/issues/${i.issueKey}/sprint`, { sprintId: active.id }),
                          );
                          reloadAll();
                        }}
                      >
                        + 排入
                      </button>
                    )}
                  </div>
                ))}
                {backlogItems.length === 0 && (
                  <p className="text-xs text-slate-300">Backlog 为空</p>
                )}
              </div>
            </Card>
          </div>
        </>
      ) : (
        !sprintsApi.loading && <EmptyState>还没有 Sprint——创建第一个迭代开始燃尽</EmptyState>
      )}

      {/* 速率 */}
      <Card className="p-4">
        <h3 className="mb-3 font-semibold text-slate-700">速率（已完成 Sprint 的交付量）</h3>
        {velocityApi.loading ? <Spinner /> : <VelocityBars items={velocityApi.data?.items ?? []} />}
      </Card>

      {/* 创建 Sprint */}
      {creating && (
        <Modal title="创建 Sprint" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="名称，如 Sprint 2"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="迭代目标（可选）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {action.error && <ErrorText>{action.error}</ErrorText>}
            <button
              disabled={!form.name.trim() || action.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={async () => {
                const ok = await action.run(
                  () =>
                    api.post(`/v1/projects/${projectKey}/sprints`, {
                      name: form.name,
                      goal: form.goal || undefined,
                      endsAt: form.endsAt || undefined,
                      startsAt: new Date().toISOString(),
                      status: 'PLANNED',
                    }),
                  `Sprint ${form.name} 已创建`,
                );
                if (ok !== undefined) {
                  setCreating(false);
                  setForm({ name: '', goal: '', endsAt: '' });
                  reloadAll();
                }
              }}
            >
              创建（PLANNED，排期后手动启动）
            </button>
          </div>
        </Modal>
      )}

      {/* 完成 Sprint 确认 */}
      {confirmComplete && active && (
        <Modal title={`完成 ${active.name}`} onClose={() => setConfirmComplete(false)}>
          <p className="text-sm text-slate-600">
            未完成的 issue（
            {sprintIssues.filter((i) => i.stateCategory !== 'DONE').length} 个）将自动退回 Backlog。
          </p>
          {action.error && (
            <div className="mt-2">
              <ErrorText>{action.error}</ErrorText>
            </div>
          )}
          <button
            className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            onClick={async () => {
              const r = await action.run(() =>
                api.patch<{ returnedToBacklog: number }>(
                  `/v1/projects/${projectKey}/sprints/${active.id}/status`,
                  {
                    status: 'COMPLETED',
                  },
                ),
              );
              if (r !== undefined) {
                setConfirmComplete(false);
                reloadAll();
              }
            }}
          >
            确认完成（未完成项退回 Backlog）
          </button>
        </Modal>
      )}
    </div>
  );
}
