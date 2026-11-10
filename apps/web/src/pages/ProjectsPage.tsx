import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellOutlined,
  PlusOutlined,
  RightOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { ProjectSummary } from '../api/types.js';
import { Card, EmptyState, ErrorText, Modal, Spinner } from '../components/ui.js';

interface NotifRow {
  id: string;
  type: string;
  readAt: string | null;
  payload: Record<string, unknown>;
}

/** 首页工作台卡：我的未完成 / @提及提醒 / 快捷入口。 */
function WorkbenchCard() {
  const work = useApi<{
    assigned: Array<{ stateCategory: string }>;
    watching: unknown[];
    reported: unknown[];
  }>('/v1/my/work');
  const notifs = useApi<{ items: NotifRow[] }>('/v1/notifications?limit=50');

  const openCount = work.data?.assigned.filter((i) => i.stateCategory !== 'DONE').length ?? 0;
  const mentionCount =
    notifs.data?.items.filter((n) => n.type === 'comment.mentioned' && !n.readAt).length ?? 0;
  if (work.error && notifs.error) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          to="/my"
          className="flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 transition hover:bg-indigo-100"
        >
          <UserOutlined className="text-xl text-indigo-500" aria-hidden />
          <span>
            <span className="block text-lg font-bold text-indigo-700">{openCount}</span>
            <span className="block text-xs text-slate-500">我的未完成</span>
          </span>
          <RightOutlined className="ml-auto text-xs text-indigo-300" aria-hidden />
        </Link>
        <Link
          to="/team"
          className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100"
        >
          <BellOutlined
            className={`text-xl ${mentionCount > 0 ? 'text-red-500' : 'text-slate-400'}`}
            aria-hidden
          />
          <span>
            <span
              className={`block text-lg font-bold ${mentionCount > 0 ? 'text-red-600' : 'text-slate-700'}`}
            >
              {mentionCount}
            </span>
            <span className="block text-xs text-slate-500">@提及未读</span>
          </span>
          <RightOutlined className="ml-auto text-xs text-slate-300" aria-hidden />
        </Link>
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-xs font-medium text-slate-500">快捷入口：</span>
          <Link
            to="/my"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            我的工作
          </Link>
          <Link
            to="/team"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            团队成员
          </Link>
        </div>
      </div>
    </Card>
  );
}

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
        <span className="flex items-center gap-2">
          <Link
            to="/my"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <UserOutlined aria-hidden />
            我的工作
          </Link>
          <Link
            to="/team"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <TeamOutlined aria-hidden />
            团队成员
          </Link>
        </span>
        <button
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          <PlusOutlined aria-hidden />
          创建项目
        </button>
      </div>

      <WorkbenchCard />

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
