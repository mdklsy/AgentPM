import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router-dom';
import {
  AimOutlined,
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  InboxOutlined,
  RobotOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useApi } from '../api/hooks.js';
import type { ProjectDetail } from '../api/types.js';
import { IssueDrawer } from '../components/IssueDrawer.js';
import { NotificationBell } from '../components/NotificationBell.js';
import { ErrorText, Logo, Spinner } from '../components/ui.js';
import { useAuth } from '../auth.js';

export interface ProjectPageCtx {
  projectKey: string;
  detail: ProjectDetail;
  reloadDetail: () => void;
  openIssue: (issueKey: string) => void;
}

const TABS = [
  { to: '', label: '看板', icon: AppstoreOutlined },
  { to: 'sprint', label: 'Sprint', icon: AimOutlined },
  { to: 'backlog', label: 'Backlog', icon: InboxOutlined },
  { to: 'monitoring', label: '监控', icon: DashboardOutlined },
  { to: 'overview', label: '总览', icon: BarChartOutlined },
  { to: 'activity', label: '活动流', icon: ThunderboltOutlined },
  { to: 'agents', label: 'Agent', icon: RobotOutlined },
  { to: 'approvals', label: '审批', icon: AuditOutlined },
  { to: 'regressions', label: '回归', icon: ExperimentOutlined },
  { to: 'members', label: '成员', icon: TeamOutlined },
  { to: 'webhooks', label: 'Webhooks', icon: ApiOutlined },
];

export function ProjectLayout() {
  const { key = '' } = useParams();
  const { data, loading, error, reload } = useApi<ProjectDetail>(`/v1/projects/${key}`);
  const { me } = useAuth();
  const [drawer, setDrawer] = useState<string | null>(null);

  // 通知点击跳转的握手：事件（同页面即时）+ sessionStorage（跨路由挂载时消费）
  useEffect(() => {
    const consume = (issueKey: string | null) => {
      if (!issueKey) return;
      sessionStorage.removeItem('apm:openIssue');
      setDrawer(issueKey);
    };
    consume(sessionStorage.getItem('apm:openIssue'));
    const onOpen = (e: Event) => consume((e as CustomEvent<string>).detail);
    window.addEventListener('apm:open-issue', onOpen);
    return () => window.removeEventListener('apm:open-issue', onOpen);
  }, []);

  const reloadAll = useCallback(() => {
    reload();
  }, [reload]);

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="p-6">
        <ErrorText>{error}</ErrorText>
        <Link className="mt-3 inline-block text-sm text-indigo-600 underline" to="/">
          返回项目列表
        </Link>
      </div>
    );
  if (!data || !me) return <Navigate to="/" replace />;

  const ctx: ProjectPageCtx = {
    projectKey: key,
    detail: data,
    reloadDetail: reloadAll,
    openIssue: setDrawer,
  };

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <Link to="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-700" title="返回项目列表">
          <Logo className="h-5 w-5" />
        </Link>
        <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-sm font-bold text-indigo-600">
          {key}
        </span>
        <span className="font-semibold text-slate-800">{data.project.name}</span>
        <span className="ml-2 hidden rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline">
          agent 策略：
          {data.project.settings.agentPolicy.bugCreate === 'approval' ? '提bug需审批 · ' : ''}
          {data.project.settings.agentPolicy.completeTransition === 'approval'
            ? '完成需审批'
            : '全自动'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <span className="flex items-center gap-1 text-sm text-slate-500">
            <UserOutlined aria-hidden />
            {me.displayName}（{data.myRole}）
          </span>
        </span>
      </header>

      {/* 页签 */}
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={`/p/${key}${t.to ? '/' + t.to : ''}`}
            end={t.to === ''}
            className={({ isActive }) =>
              `flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`
            }
          >
            <t.icon aria-hidden />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 overflow-auto bg-slate-100 p-4">
        <Outlet context={ctx} />
      </main>

      {drawer && (
        <IssueDrawer
          issueKey={drawer}
          detail={data}
          me={me}
          onClose={() => setDrawer(null)}
          onChanged={reloadAll}
        />
      )}
    </div>
  );
}
