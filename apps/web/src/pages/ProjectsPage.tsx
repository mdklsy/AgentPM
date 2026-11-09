import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { ProjectSummary } from '../api/types.js';
import { Card, EmptyState, ErrorText, Modal, Spinner } from '../components/ui.js';

export function ProjectsPage() {
  const { data, loading, error, reload } = useApi<{ projects: ProjectSummary[] }>('/v1/projects');
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const create = useAction();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">我的项目</h1>
          <p className="text-sm text-slate-500">人类与 agent 共享同一份项目视图</p>
        </div>
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          + 创建项目
        </button>
      </div>

      {loading && <Spinner />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && data.projects.length === 0 && (
        <EmptyState>还没有项目——创建第一个，或问问你的 agent（project.list）</EmptyState>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {data?.projects.map((p) => (
          <Link key={p.key} to={`/p/${p.key}`}>
            <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-sm font-bold text-indigo-600">
                  {p.key}
                </span>
                <span className="font-semibold text-slate-800">{p.name}</span>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {p.myRole}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-slate-500">{p.description ?? '—'}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                <span>{p.openIssues} 个未完成</span>
                <span>{p.visibility}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {creating && (
        <Modal title="创建项目" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500">
                项目 KEY（如 APM，2-10 位大写字母/数字）
              </label>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
                placeholder="APM"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">项目名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="我的项目"
              />
            </div>
            <p className="text-xs text-slate-400">
              创建后自动播种各 issue 类型的默认工作流，你将成为 OWNER。
            </p>
            {create.error && <ErrorText>{create.error}</ErrorText>}
            <button
              disabled={create.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={async () => {
                const ok = await create.run(
                  () => api.post('/v1/projects', { key, name }),
                  `项目 ${key} 已创建`,
                );
                if (ok !== undefined) {
                  setCreating(false);
                  reload();
                }
              }}
            >
              创建
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
