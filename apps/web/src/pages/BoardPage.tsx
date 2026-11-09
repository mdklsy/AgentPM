import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/client.js';
import { qs } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { IssueListItem, Priority } from '../api/types';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { KanbanBoard } from '../components/KanbanBoard.js';
import { ErrorText, Modal, PriorityBadge, TypeBadge } from '../components/ui.js';

export function BoardPage() {
  const { projectKey, detail, openIssue } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error, reload } = useApi<{ items: IssueListItem[]; total: number }>(
    `/v1/projects/${projectKey}/issues${qs({ pageSize: 100, sort: 'priority_asc' })}`,
  );
  const [creating, setCreating] = useState(false);
  const create = useAction();
  const [form, setForm] = useState({
    type: 'TASK',
    title: '',
    description: '',
    priority: 'P2' as Priority,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <button
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          + 新建 Issue
        </button>
        <span className="text-xs text-slate-400">共 {data?.total ?? '…'} 个</span>
      </div>
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
