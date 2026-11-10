import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { api, qs } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { ApprovalItem } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import {
  ActorChip,
  Card,
  EmptyState,
  ErrorText,
  Spinner,
  SuccessText,
  timeAgo,
} from '../components/ui.js';

/** 审批收件箱：token 渠道（自动化）被策略拦截的高危动作（提 bug / 完成流转）在这里放行或拒绝 */
export function ApprovalsPage() {
  const { projectKey } = useOutletContext<ProjectPageCtx>();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const { data, loading, error, reload } = useApi<{ approvals: ApprovalItem[] }>(
    `/v1/projects/${projectKey}/approvals${qs({ status })}`,
  );
  const decide = useAction();
  const [reason, setReason] = useState<Record<string, string>>({});

  const decideOn = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const ok = await decide.run(
      () => api.post(`/v1/approvals/${id}/decision`, { decision, reason: reason[id] || undefined }),
      decision === 'APPROVED' ? '已批准并代为执行' : '已拒绝',
    );
    if (ok !== undefined) reload();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-semibold text-slate-700">审批收件箱</h2>
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s === 'PENDING' ? '待审批' : s === 'APPROVED' ? '已批准' : '已拒绝'}
          </button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && data.approvals.length === 0 && (
        <EmptyState>
          {status === 'PENDING'
            ? '没有待审批的请求——自动化渠道的高危动作被策略拦截后会出现在这里'
            : '暂无记录'}
        </EmptyState>
      )}

      <div className="space-y-3">
        {data?.approvals.map((a) => {
          const p = a.payload as {
            issueKey?: string;
            toState?: string;
            title?: string;
            projectKey?: string;
          };
          return (
            <Card key={a.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {a.actionType}
                </span>
                <ActorChip name={a.requestedBy} type={a.requestedByType} />
                <span className="text-slate-600">
                  {a.actionType === 'issue.transition'
                    ? `请求将 ${p.issueKey} 流转为「${p.toState}」`
                    : `请求提 bug：「${p.title}」`}
                </span>
                <span className="ml-auto text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
              </div>
              {a.status !== 'PENDING' && (
                <div className="mt-2 text-xs text-slate-400">
                  {a.status} · 处理人 {a.decidedBy} · {a.reason ?? ''}
                </div>
              )}
              {a.status === 'PENDING' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={reason[a.id] ?? ''}
                    onChange={(e) => setReason({ ...reason, [a.id]: e.target.value })}
                    placeholder="理由（可选）"
                    className="min-w-48 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                  <button
                    disabled={decide.running}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    onClick={() => void decideOn(a.id, 'APPROVED')}
                  >
                    <CheckOutlined aria-hidden /> 批准
                  </button>
                  <button
                    disabled={decide.running}
                    className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                    onClick={() => void decideOn(a.id, 'REJECTED')}
                  >
                    <CloseOutlined aria-hidden /> 拒绝
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {decide.error && (
        <div className="mt-2">
          <ErrorText>{decide.error}</ErrorText>
        </div>
      )}
      {decide.message && (
        <div className="mt-2">
          <SuccessText>{decide.message}</SuccessText>
        </div>
      )}
    </div>
  );
}
