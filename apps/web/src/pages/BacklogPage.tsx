import { useOutletContext } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { ActorChip, EmptyState, PriorityBadge, Spinner, TypeBadge } from '../components/ui.js';

interface BacklogItem {
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  state: string;
  assignee: string | null;
  labels: string[];
}

export function BacklogPage() {
  const { projectKey, openIssue } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error } = useApi<{ backlog: BacklogItem[] }>(
    `/v1/projects/${projectKey}/backlog`,
  );

  if (loading) return <Spinner />;
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!data?.backlog.length)
    return <EmptyState>Backlog 为空——未排期的未完成 issue 会出现在这里</EmptyState>;

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <p className="mb-2 text-sm text-slate-500">
        未排期（无 Sprint）且未完成的 issue。这是 agent{' '}
        <code className="rounded bg-white px-1">issue.claim</code> 抢单的主要池子。
      </p>
      {data.backlog.map((i) => (
        <div
          key={i.issueKey}
          onClick={() => openIssue(i.issueKey)}
          className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm hover:shadow-md"
        >
          <TypeBadge type={i.type as never} />
          <PriorityBadge priority={i.priority as never} />
          <span className="font-mono text-xs text-slate-400">{i.issueKey}</span>
          <span className="flex-1 truncate text-slate-700">{i.title}</span>
          {i.labels.map((l) => (
            <span key={l} className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500">
              {l}
            </span>
          ))}
          {i.assignee ? (
            <ActorChip name={i.assignee} />
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
              可领取
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
