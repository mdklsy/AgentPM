import type { ReactNode } from 'react';
import { CloseOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import type { ActivitySource, ActorType, IssueType, Priority } from '../api/types.js';

/* ---------------- 基础组件 ---------------- */

/** AgentPM 六边形 Logo（内联 SVG，随文字颜色染色）。 */
export function Logo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 1.7 21 6.85v10.3L12 22.3 3 17.15V6.85L12 1.7Z" fill="currentColor" opacity=".12" />
      <path
        d="M12 1.7 21 6.85v10.3L12 22.3 3 17.15V6.85L12 1.7Zm0 2.1L4.9 7.9v8.2L12 20.2l7.1-4.1V7.9L12 3.8Z"
        fill="currentColor"
      />
      <path d="M12 7.2 15.6 16h-1.9l-.85-2.2h-1.7L10.3 16H8.4L12 7.2Zm0 3.4-.55 1.6h1.1L12 10.6Z" fill="currentColor" />
    </svg>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
      {label ?? '加载中…'}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{children}</div>;
}

export function SuccessText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{children}</div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-10 text-center text-sm text-slate-400">
      {children}
    </div>
  );
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className={`max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-auto rounded-2xl bg-white p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            className="rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseOutlined />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- 徽章 ---------------- */

const TYPE_STYLE: Record<IssueType, string> = {
  EPIC: 'bg-violet-100 text-violet-700',
  STORY: 'bg-sky-100 text-sky-700',
  TASK: 'bg-slate-200 text-slate-700',
  BUG: 'bg-red-100 text-red-700',
  SUBTASK: 'bg-slate-100 text-slate-500',
};

export function TypeBadge({ type }: { type: IssueType }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_STYLE[type]}`}>
      {type}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-orange-500 text-white',
  P2: 'bg-amber-400 text-amber-900',
  P3: 'bg-slate-300 text-slate-700',
  P4: 'bg-slate-200 text-slate-500',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[priority]}`}>
      {priority}
    </span>
  );
}

const SOURCE_STYLE: Record<ActivitySource, string> = {
  WEB: 'bg-slate-100 text-slate-600',
  API: 'bg-sky-100 text-sky-700',
  MCP: 'bg-violet-100 text-violet-700',
  SYSTEM: 'bg-emerald-100 text-emerald-700',
};

export function SourceBadge({ source }: { source: ActivitySource }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SOURCE_STYLE[source]}`}>
      {source}
    </span>
  );
}

export const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'border-t-slate-400',
  IN_PROGRESS: 'border-t-indigo-500',
  DONE: 'border-t-emerald-500',
};

export function ActorChip({
  name,
  type,
  avatarUrl,
}: {
  name: string;
  type?: ActorType | null;
  avatarUrl?: string | null;
}) {
  const isAgent = type === 'AGENT' || type === 'AVATAR';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        isAgent ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
      }`}
      title={type ?? undefined}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
      ) : isAgent ? (
        <RobotOutlined aria-hidden />
      ) : (
        <UserOutlined aria-hidden />
      )}
      {name}
    </span>
  );
}

/** 用户头像（无头像时回退首字母）。 */
export function Avatar({
  name,
  avatarUrl,
  className = 'h-8 w-8',
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  if (avatarUrl)
    return <img src={avatarUrl} alt={name} className={`${className} rounded-full object-cover`} />;
  return (
    <span
      className={`${className} inline-flex items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-600`}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
