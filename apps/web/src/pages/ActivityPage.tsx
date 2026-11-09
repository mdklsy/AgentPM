import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { qs } from '../api/client.js';
import { useApi } from '../api/hooks.js';
import type { ActivityItem, ActivitySource } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { ActivityFeed } from '../components/ActivityFeed.js';

const FILTERS: Array<{ value: ActivitySource | null; label: string }> = [
  { value: null, label: '全部' },
  { value: 'WEB', label: '网页' },
  { value: 'MCP', label: 'Agent(MCP)' },
  { value: 'API', label: 'API' },
  { value: 'SYSTEM', label: '系统/审批' },
];

export function ActivityPage() {
  const { projectKey, openIssue } = useOutletContext<ProjectPageCtx>();
  const [filter, setFilter] = useState<ActivitySource | null>(null);
  const { data, loading } = useApi<{ items: ActivityItem[] }>(
    `/v1/projects/${projectKey}/activities${qs({ limit: 50 })}`,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.value
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">
          实时流：人和 agent 的动作即刻出现在这里
        </span>
      </div>
      <div
        onClickCapture={(e) => {
          // 点击带 issue 前缀的行打开详情
          const el = (e.target as HTMLElement).closest('[data-issue]');
          const issue = el?.getAttribute('data-issue');
          if (issue) openIssue(issue);
        }}
      >
        <ActivityFeed
          projectKey={projectKey}
          initialItems={data?.items ?? []}
          initialLoading={loading}
          sourceFilter={filter}
        />
      </div>
    </div>
  );
}
