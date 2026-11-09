import { useState } from 'react';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { IssueDetail, ProjectDetail } from '../api/types.js';
import type { Me } from '../auth.js';
import {
  ActorChip,
  ErrorText,
  PriorityBadge,
  Spinner,
  SuccessText,
  TypeBadge,
  timeAgo,
} from './ui.js';

/** issue 详情抽屉：流转 / 领取 / 指派 / 评论 / 进度汇报 */
export function IssueDrawer({
  issueKey,
  detail,
  me,
  onClose,
  onChanged,
}: {
  issueKey: string;
  detail: ProjectDetail;
  me: Me;
  onClose: () => void;
  onChanged: () => void;
}) {
  const {
    data: issue,
    loading,
    error,
    reload,
  } = useApi<{ issue: IssueDetail }>(`/v1/issues/${issueKey}`);
  const [comment, setComment] = useState('');
  const [percent, setPercent] = useState(60);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const commentAction = useAction();

  const workflow = detail.workflows.find((w) => w.issueType === issue?.issue.type);
  const allowedNext = (
    issue && workflow
      ? workflow.transitions
          .filter((t) => t.from === null || t.from === issue.issue.state)
          .map((t) => t.to)
          .filter((s) => s !== issue.issue.state)
      : []
  ).filter((s, i, arr) => arr.indexOf(s) === i);

  const act = async (fn: () => Promise<unknown>, info?: string): Promise<unknown> => {
    setBusy(true);
    setActionError(null);
    setActionInfo(null);
    try {
      const result = await fn();
      const r = result as { status?: string; message?: string } | undefined;
      if (r && typeof r === 'object' && r.status === 'pending_approval') {
        setActionInfo(r.message ?? '该动作需要人工审批，已进入审批队列');
      } else if (info) {
        setActionInfo(info);
      }
      reload();
      onChanged();
      return result;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const d = issue?.issue;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <Spinner />}
        {error && (
          <div className="p-4">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {d && (
          <>
            {/* header */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-slate-400">{d.issueKey}</span>
                <TypeBadge type={d.type} />
                <PriorityBadge priority={d.priority} />
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {d.state}
                </span>
                {d.assignee ? (
                  <ActorChip name={d.assignee} />
                ) : (
                  <span className="text-xs text-amber-600">未指派</span>
                )}
                <button
                  className="ml-auto rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={onClose}
                >
                  ✕
                </button>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-800">{d.title}</h2>

              {actionError && (
                <div className="mt-2">
                  <ErrorText>{actionError}</ErrorText>
                </div>
              )}
              {actionInfo && (
                <div className="mt-2">
                  <SuccessText>{actionInfo}</SuccessText>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">流转：</span>
                {allowedNext.map((s) => (
                  <button
                    key={s}
                    disabled={busy}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    onClick={() =>
                      void act(
                        () => api.post(`/v1/issues/${d.issueKey}/transition`, { toState: s }),
                        `已流转到 ${s}`,
                      )
                    }
                  >
                    → {s}
                  </button>
                ))}
                {d.assignee === me.name ? (
                  <button
                    disabled={busy}
                    className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    onClick={() =>
                      act(
                        () => api.post(`/v1/issues/${d.issueKey}/release`, { reason: '人工释放' }),
                        '已释放',
                      )
                    }
                  >
                    释放任务
                  </button>
                ) : !d.assignee ? (
                  <button
                    disabled={busy}
                    className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                    onClick={() =>
                      act(() => api.post(`/v1/issues/${d.issueKey}/claim`, {}), '已领取')
                    }
                  >
                    领取给我
                  </button>
                ) : null}
                <select
                  className="ml-auto rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
                  value={d.assignee ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    act(
                      () =>
                        api.post(`/v1/issues/${d.issueKey}/assign`, {
                          assigneeName: e.target.value || null,
                        }),
                      '已更新指派',
                    )
                  }
                >
                  <option value="">（未指派）</option>
                  {detail.members.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}（{m.role}）
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-1 space-y-5 px-5 py-4">
              {/* 描述 */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">描述</h3>
                <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {d.description || '（无描述）'}
                </div>
                <div className="mt-1 flex gap-3 text-xs text-slate-400">
                  <span>报告人 {d.reporter}</span>
                  {d.fingerprint && <span>指纹 {d.fingerprint}</span>}
                  {d.environment && <span>环境 {d.environment}</span>}
                </div>
              </section>

              {/* 进度汇报 */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">
                  进度汇报（人与 agent 同源）
                </h3>
                <div className="space-y-2">
                  {d.progressReports.map((p, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <ActorChip name={p.actor} />
                        <span className="font-semibold text-indigo-600">{p.percent}%</span>
                        <span className="ml-auto text-xs text-slate-400">
                          {timeAgo(p.createdAt)}
                        </span>
                      </div>
                      {p.notes && <div className="mt-1 text-slate-600">{p.notes}</div>}
                      {p.blockers.length > 0 && (
                        <div className="mt-1 text-xs text-red-500">
                          阻塞：{p.blockers.map((b) => b.issueKey ?? b.description).join('；')}
                        </div>
                      )}
                      {p.artifacts.map((a) => (
                        <a
                          key={a.url}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block rounded bg-white px-2 py-0.5 text-xs text-sky-600 underline"
                        >
                          📎 {a.name}
                        </a>
                      ))}
                    </div>
                  ))}
                  {d.progressReports.length === 0 && (
                    <div className="text-xs text-slate-300">暂无进度汇报</div>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(e) => setPercent(Number(e.target.value))}
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="备注（可选）"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                  <button
                    disabled={busy}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    onClick={() =>
                      act(
                        () =>
                          api.post(`/v1/issues/${d.issueKey}/progress`, {
                            percent,
                            notes: notes || undefined,
                            blockers: [],
                            artifacts: [],
                          }),
                        '进度已记录',
                      )
                    }
                  >
                    汇报进度
                  </button>
                </div>
              </section>

              {/* 评论 */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">
                  评论（agent 的结构化证据也在这里）
                </h3>
                <div className="space-y-2">
                  {d.comments.map((c, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-100 p-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <ActorChip name={c.author} type={c.authorType} />
                        <span className="ml-auto text-xs text-slate-400">
                          {timeAgo(c.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-slate-700">{c.body}</div>
                      {c.evidence && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-violet-600">
                            证据数据
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-xs text-emerald-300">
                            {JSON.stringify(c.evidence, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                  {d.comments.length === 0 && (
                    <div className="text-xs text-slate-300">暂无评论</div>
                  )}
                </div>
                <div className="mt-2">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    placeholder="添加评论…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  {commentAction.error && <ErrorText>{commentAction.error}</ErrorText>}
                  <div className="mt-1 flex justify-end">
                    <button
                      disabled={!comment.trim() || commentAction.running}
                      className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      onClick={async () => {
                        const ok = await commentAction.run(() =>
                          api.post(`/v1/issues/${d.issueKey}/comments`, { body: comment }),
                        );
                        if (ok !== undefined) {
                          setComment('');
                          reload();
                        }
                      }}
                    >
                      评论
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
