import { Link, useNavigate } from 'react-router-dom';
import { EyeOutlined, FileAddOutlined, UserOutlined } from '@ant-design/icons';
import { useApi } from '../api/hooks.js';
import type { MyWorkItem, MyWorkResp } from '../api/types.js';
import { NotificationBell } from '../components/NotificationBell.js';
import {
  Avatar,
  EmptyState,
  ErrorText,
  PriorityBadge,
  Spinner,
  TypeBadge,
  timeAgo,
} from '../components/ui.js';
import { useAuth } from '../auth.js';

/** 我的工作（跨项目）：三组列表，点击跳进项目并自动打开 issue 抽屉。 */

const GROUPS: Array<{
  key: keyof MyWorkResp;
  title: string;
  icon: typeof UserOutlined;
  hint: string;
}> = [
  { key: 'assigned', title: '指派给我的', icon: UserOutlined, hint: '需要你处理的' },
  { key: 'watching', title: '我关注的', icon: EyeOutlined, hint: '有变动会通知你' },
  { key: 'reported', title: '我创建的', icon: FileAddOutlined, hint: '你提出的' },
];

function IssueRow({ item, onOpen }: { item: MyWorkItem; onOpen: (i: MyWorkItem) => void }) {
  return (
    <button
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm shadow-sm hover:shadow-md"
    >
      <TypeBadge type={item.type} />
      <PriorityBadge priority={item.priority} />
      <span className="font-mono text-xs text-slate-400">{item.issueKey}</span>
      <span className="flex-1 truncate text-slate-700">{item.title}</span>
      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
        {item.projectKey}
      </span>
      <span className="w-20 truncate text-right text-xs text-slate-400">{item.state}</span>
      <span className="w-14 text-right text-[11px] text-slate-300">{timeAgo(item.updatedAt)}</span>
    </button>
  );
}

export function MyWorkPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useApi<MyWorkResp>('/v1/my/work');

  const open = (i: MyWorkItem) => {
    // 与 ProjectLayout 的握手：事件即时打开抽屉；storage 供跨路由挂载时消费
    sessionStorage.setItem('apm:openIssue', i.issueKey);
    navigate(`/p/${i.projectKey}`);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <Link to="/" title="返回项目列表" className="text-slate-500 hover:text-slate-700">
          ←
        </Link>
        <span className="text-lg font-bold text-slate-800">我的工作</span>
        <span className="ml-auto flex items-center gap-2">
          <NotificationBell />
          {me && (
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Avatar
                name={me.displayName || me.name}
                avatarUrl={me.avatarUrl}
                className="h-6 w-6"
              />
              {me.displayName}
            </span>
          )}
        </span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 overflow-auto p-4">
        {loading && <Spinner />}
        {error && <ErrorText>{error}</ErrorText>}
        {data &&
          GROUPS.map((g) => {
            const items = data[g.key];
            return (
              <section key={g.key}>
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <g.icon aria-hidden className="text-slate-400" />
                  {g.title}
                  <span className="rounded-full bg-slate-200 px-1.5 text-xs text-slate-500">
                    {items.length}
                  </span>
                  <span className="text-xs font-normal text-slate-400">{g.hint}</span>
                </h2>
                {items.length === 0 ? (
                  <p className="rounded-xl bg-white/60 px-3 py-3 text-xs text-slate-300">暂无</p>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((i) => (
                      <IssueRow key={i.issueKey} item={i} onOpen={open} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        {data && data.assigned.length + data.watching.length + data.reported.length === 0 && (
          <EmptyState>没有和你相关的 issue——去项目里认领一个，或让 agent 帮你建</EmptyState>
        )}
      </main>
    </div>
  );
}
