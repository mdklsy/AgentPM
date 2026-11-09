import { useEffect, useRef, useState } from 'react';
import type { ActivityItem, ActivitySource } from '../api/types.js';
import { ActorChip, EmptyState, SourceBadge, Spinner, timeAgo } from './ui.js';

/**
 * 人机同源活动流：初始 REST 拉取 + SSE 实时增量（EventSource，同源 cookie 认证）。
 * sourceFilter 为 null 时展示全部。
 */
export function ActivityFeed({
  projectKey,
  initialItems,
  initialLoading,
  sourceFilter,
}: {
  projectKey: string;
  initialItems: ActivityItem[];
  initialLoading: boolean;
  sourceFilter: ActivitySource | null;
}) {
  const [live, setLive] = useState<ActivityItem[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const es = new EventSource(`/v1/projects/${projectKey}/events`);
    es.addEventListener('hello', () => setConnected(true));
    es.addEventListener('activity', (e) => {
      try {
        const item = JSON.parse((e as MessageEvent).data) as ActivityItem;
        if (seen.current.has(item.id!)) return;
        seen.current.add(item.id!);
        setLive((prev) => [item, ...prev].slice(0, 200));
      } catch {
        /* 忽略坏帧 */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [projectKey]);

  const sourceMatch = (a: ActivityItem) => !sourceFilter || a.source === sourceFilter;
  const merged = [...live.filter(sourceMatch), ...initialItems.filter(sourceMatch)];

  if (initialLoading) return <Spinner />;
  if (merged.length === 0) return <EmptyState>暂无活动</EmptyState>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
        <span
          className={`inline-block h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`}
        />
        {connected ? '实时连接中（SSE）' : '离线/重连中'}
      </div>
      <div className="space-y-1.5">
        {merged.map((a, i) => (
          <div
            key={a.id ?? `${a.createdAt}-${i}`}
            data-issue={a.issue ?? undefined}
            className={`flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm shadow-sm ${
              a.issue ? 'cursor-pointer hover:border-indigo-200' : ''
            }`}
          >
            <SourceBadge source={a.source} />
            {a.actor && <ActorChip name={a.actor.name} type={a.actor.type} />}
            <span className="flex-1 truncate text-slate-700">
              {a.issue && <span className="mr-1 font-mono text-xs text-indigo-500">{a.issue}</span>}
              {a.summary}
            </span>
            <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
