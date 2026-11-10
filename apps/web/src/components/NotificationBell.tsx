import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AuditOutlined,
  BellOutlined,
  CheckCircleOutlined,
  FileProtectOutlined,
  MessageOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { api } from '../api/client.js';
import { timeAgo } from './ui.js';

interface NotificationItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  'issue.assigned': '你被指派了任务',
  'issue.completed': '你关注的 issue 已完成',
  'comment.added': '你关注的 issue 有新评论',
  'comment.mentioned': '有人在评论里 @ 了你',
  'approval.requested': '有 agent 动作待你审批',
  'approval.decided': '你的审批请求有结果',
  'report.published': '替身发布了新报告',
};

const TYPE_ICON: Record<string, typeof BellOutlined> = {
  'issue.assigned': UserAddOutlined,
  'issue.completed': CheckCircleOutlined,
  'comment.added': MessageOutlined,
  'comment.mentioned': MessageOutlined,
  'approval.requested': AuditOutlined,
  'approval.decided': FileProtectOutlined,
  'report.published': BellOutlined,
};

/** 顶栏通知铃铛：30s 轮询未读数；下拉面板可跳转对应 issue。 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const loadUnread = useCallback(async () => {
    try {
      const r = await api.get<{ unread: number }>('/v1/notifications?limit=1');
      setUnread(r.unread);
    } catch {
      /* 静默 */
    }
  }, []);

  useEffect(() => {
    void loadUnread();
    const t = setInterval(() => void loadUnread(), 30_000);
    return () => clearInterval(t);
  }, [loadUnread]);

  useEffect(() => {
    if (!open) return;
    void api
      .get<{ items: NotificationItem[] }>('/v1/notifications?limit=15')
      .then((r) => setItems(r.items))
      .catch(() => {});
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const jump = async (n: NotificationItem) => {
    const projectKey = n.payload.projectKey as string | undefined;
    const issueKey = n.payload.issueKey as string | undefined;
    setOpen(false);
    if (issueKey) {
      // 双通道握手：事件即时打开抽屉；storage 供跨路由挂载时消费
      window.dispatchEvent(new CustomEvent('apm:open-issue', { detail: issueKey }));
      sessionStorage.setItem('apm:openIssue', issueKey);
    }
    if (projectKey) navigate(`/p/${projectKey}`);
    if (!n.readAt) {
      await api.post(`/v1/notifications/${n.id}/read`).catch(() => {});
      void loadUnread();
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="relative rounded-full p-1.5 text-base leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        onClick={() => setOpen((v) => !v)}
        title="通知"
        aria-label="通知"
      >
        <BellOutlined />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">通知</span>
            <button
              className="text-xs text-indigo-600 hover:underline"
              onClick={async () => {
                await api.post('/v1/notifications/read-all').catch(() => {});
                setItems((arr) =>
                  arr.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })),
                );
                void loadUnread();
              }}
            >
              全部已读
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-300">暂无通知</p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => void jump(n)}
                className={`flex w-full flex-col gap-0.5 border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  n.readAt ? 'opacity-60' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  {(() => {
                    const Icon = TYPE_ICON[n.type] ?? BellOutlined;
                    return <Icon className="text-xs text-slate-400" aria-hidden />;
                  })()}
                  <span className="text-xs font-medium text-slate-700">
                    {TYPE_LABEL[n.type] ?? n.type}
                  </span>
                  {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  <span className="ml-auto text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                </span>
                <span className="truncate text-xs text-slate-500">
                  {typeof n.payload.issueKey === 'string' ? `${n.payload.issueKey} · ` : ''}
                  {(n.payload.title as string) ?? (n.payload.actionType as string) ?? ''}
                  {n.payload.decision
                    ? ` → ${n.payload.decision === 'APPROVED' ? '已批准' : '已拒绝'}`
                    : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
