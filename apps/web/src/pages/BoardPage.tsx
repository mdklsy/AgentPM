import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { IssueListItem, Priority, SavedFilterItem } from '../api/types';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { KanbanBoard } from '../components/KanbanBoard.js';
import { ErrorText, Modal, PriorityBadge, TypeBadge } from '../components/ui.js';

/** 看板（M6 扩展）：搜索/指派/优先级过滤 + 保存的过滤器 chips。 */
export function BoardPage() {
  const { projectKey, detail, openIssue } = useOutletContext<ProjectPageCtx>();
  const [filter, setFilter] = useState<{ q?: string; assignee?: string; priority?: string }>({});
  const { data, loading, error, reload } = useApi<{ items: IssueListItem[]; total: number }>(
    `/v1/projects/${projectKey}/issues${qs({ pageSize: 100, sort: 'priority_asc', ...filter })}`,
  );
  const filtersApi = useApi<{ filters: SavedFilterItem[] }>(`/v1/projects/${projectKey}/filters`);
  const [creating, setCreating] = useState(false);
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [sharedFlag, setSharedFlag] = useState(true);
  const create = useAction();
  const filterAction = useAction();
  const [form, setForm] = useState({
    type: 'TASK',
    title: '',
    description: '',
    priority: 'P2' as Priority,
  });

  const hasFilter = !!(filter.q || filter.assignee || filter.priority);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          + 新建 Issue
        </button>
        <span className="text-xs text-slate-400">共 {data?.total ?? '…'} 个</span>
        {/* 过滤行 */}
        <input
          value={filter.q ?? ''}
          onChange={(e) => setFilter({ ...filter, q: e.target.value || undefined })}
          placeholder="搜索标题/描述…"
          className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
        />
        <select
          value={filter.assignee ?? ''}
          onChange={(e) => setFilter({ ...filter, assignee: e.target.value || undefined })}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
        >
          <option value="">全部成员</option>
          <option value="none">未指派</option>
          {detail.members.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          value={filter.priority ?? ''}
          onChange={(e) => setFilter({ ...filter, priority: e.target.value || undefined })}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
        >
          <option value="">全部优先级</option>
          {(['P0', 'P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {hasFilter && (
          <>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => setSavingFilter(true)}
              title="把当前过滤条件保存下来，下次一键应用"
            >
              保存过滤器
            </button>
            <button
              className="rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-100"
              onClick={() => setFilter({})}
            >
              清除
            </button>
          </>
        )}
      </div>

      {/* 保存的过滤器 chips */}
      {(filtersApi.data?.filters.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">保存的过滤器：</span>
          {filtersApi.data!.filters.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
            >
              <button onClick={() => setFilter(f.query as typeof filter)}>{f.name}</button>
              {(f.mine || detail.myRole === 'OWNER' || detail.myRole === 'ADMIN') && (
                <button
                  className="text-indigo-300 hover:text-red-500"
                  title="删除过滤器"
                  onClick={async () => {
                    await filterAction
                      .run(() => api.del(`/v1/projects/${projectKey}/filters/${f.id}`))
                      .then((r) => {
                        if (r !== undefined) filtersApi.reload();
                        return r;
                      });
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {filterAction.error && <ErrorText>{filterAction.error}</ErrorText>}

      {loading && <div className="flex-1" />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && (
        <div className="min-h-0 flex-1">
          <KanbanBoard
            detail={detail}
            issues={data.items}
            onChanged={reload}
            onOpenIssue={openIssue}
          />
        </div>
      )}

      {savingFilter && (
        <Modal title="保存过滤器" onClose={() => setSavingFilter(false)}>
          <input
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="过滤器名称（如：我负责的 P1）"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={sharedFlag}
              onChange={(e) => setSharedFlag(e.target.checked)}
            />
            对项目所有成员可见
          </label>
          <button
            disabled={!filterName.trim()}
            className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={async () => {
              const ok = await filterAction.run(
                () =>
                  api.post(`/v1/projects/${projectKey}/filters`, {
                    name: filterName,
                    query: filter,
                    shared: sharedFlag,
                  }),
                '过滤器已保存',
              );
              if (ok !== undefined) {
                setSavingFilter(false);
                setFilterName('');
                filtersApi.reload();
              }
            }}
          >
            保存
          </button>
        </Modal>
      )}

      {creating && (
        <Modal title={`新建 Issue · ${projectKey}`} onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
              >
                {['TASK', 'STORY', 'BUG', 'EPIC', 'SUBTASK'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
              >
                {['P0', 'P1', 'P2', 'P3', 'P4'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="标题"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="描述（Markdown，可选）"
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {create.error && <ErrorText>{create.error}</ErrorText>}
            <button
              disabled={!form.title.trim() || create.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={async () => {
                const ok = await create.run(
                  () =>
                    api.post(`/v1/projects/${projectKey}/issues`, {
                      type: form.type,
                      title: form.title,
                      description: form.description || undefined,
                      priority: form.priority,
                    }),
                  '已创建',
                );
                if (ok !== undefined) {
                  setCreating(false);
                  setForm({ type: 'TASK', title: '', description: '', priority: 'P2' });
                  reload();
                }
              }}
            >
              创建（未指派，可被 agent 领取）
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <TypeBadge type={form.type as never} />
              <PriorityBadge priority={form.priority} />
              <span>创建后进入初始状态，出现在看板最左列</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
