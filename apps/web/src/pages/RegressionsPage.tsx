import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import type { RegressionRunItem } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import {
  ActorChip,
  Card,
  EmptyState,
  ErrorText,
  Modal,
  Spinner,
  timeAgo,
} from '../components/ui.js';

interface RunDetail extends RegressionRunItem {
  cases: Array<{
    id: string;
    name: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';
    message: string | null;
    fingerprint: string | null;
    linkedIssueId: string | null;
  }>;
}

/** 回归历史：agent / CI 提交的测试矩阵，失败项自动建 bug（指纹去重） */
export function RegressionsPage() {
  const { projectKey } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error } = useApi<{ runs: RegressionRunItem[] }>(
    `/v1/projects/${projectKey}/regression-runs`,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useApi<RunDetail>(
    openId ? `/v1/projects/${projectKey}/regression-runs/${openId}` : null,
  );

  const caseStyle: Record<string, string> = {
    PASS: 'bg-emerald-100 text-emerald-700',
    FAIL: 'bg-red-100 text-red-700',
    ERROR: 'bg-orange-100 text-orange-700',
    SKIP: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-3 text-sm text-slate-500">
        agent 通过 <code className="rounded bg-white px-1">regression.submit</code>{' '}
        上报的回归运行；失败用例按项目策略自动建 bug。
      </p>
      {loading && <Spinner />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && data.runs.length === 0 && (
        <EmptyState>还没有回归记录——让 agent 跑一次并提交结果</EmptyState>
      )}

      <div className="space-y-2">
        {data?.runs.map((r) => (
          <Card
            key={r.id}
            className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-sm hover:shadow-md"
            onClick={() => setOpenId(r.id)}
          >
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${
                r.status === 'PASSED' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
              }`}
            >
              {r.status}
            </span>
            <span className="font-semibold text-slate-700">{r.suite}</span>
            <span className="text-xs text-slate-400">
              {r.passed}/{r.total} 通过
              {r.failed + r.errors > 0 ? ` · ${r.failed + r.errors} 失败` : ''}
            </span>
            <ActorChip name={r.triggeredBy.name} type={r.triggeredBy.type} />
            {r.branch && (
              <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">{r.branch}</span>
            )}
            <span className="ml-auto text-xs text-slate-400">{timeAgo(r.finishedAt)}</span>
          </Card>
        ))}
      </div>

      {openId && (
        <Modal title="回归运行详情" onClose={() => setOpenId(null)} wide>
          {detail.loading && <Spinner />}
          {detail.data && (
            <div className="space-y-1.5">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{detail.data.suite}</span>
                <span className="text-xs text-slate-400">
                  {detail.data.branch ?? '-'} · {detail.data.commitSha?.slice(0, 8) ?? '-'}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {new Date(detail.data.finishedAt).toLocaleString('zh-CN')}
                </span>
              </div>
              {detail.data.cases.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${caseStyle[c.status]}`}
                  >
                    {c.status}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-slate-600">{c.name}</span>
                  {c.message && (
                    <details className="max-w-72">
                      <summary className="cursor-pointer truncate text-xs text-red-500">
                        {c.message.slice(0, 40)}…
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900 p-2 text-xs text-emerald-300">
                        {c.message}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
