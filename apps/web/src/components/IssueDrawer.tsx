import { useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  CloseOutlined,
  PaperClipOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { IssueDetail, ProjectDetail } from '../api/types.js';
import type { Me } from '../auth.js';
import { Markdown } from './Markdown.js';
import { Avatar } from './ui.js';
import {
  ActorChip,
  ErrorText,
  PriorityBadge,
  Spinner,
  SuccessText,
  TypeBadge,
  timeAgo,
} from './ui.js';

/** issue 详情抽屉（M6 扩展）：流转/领取/指派/评论(@提及)/进度/附件/工时/自定义字段/版本 */
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
  const uploadAction = useAction();
  const worklogAction = useAction();
  const fieldAction = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [worklogMinutes, setWorklogMinutes] = useState('');
  const [worklogComment, setWorklogComment] = useState('');

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

  /** 上传附件：multipart → api.upload。 */
  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const ok = await uploadAction.run(() =>
      api.upload(`/v1/issues/${d?.issueKey}/attachments`, fd),
    );
    if (ok !== undefined) reload();
  };

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
                  aria-label="关闭"
                >
                  <CloseOutlined />
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
                    <ArrowRightOutlined aria-hidden /> {s}
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
              {/* 描述（Markdown 渲染） */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">描述</h3>
                {d.description ? (
                  <Markdown text={d.description} className="rounded-lg bg-slate-50 p-3" />
                ) : (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-300">
                    （无描述）
                  </div>
                )}
                <div className="mt-1 flex gap-3 text-xs text-slate-400">
                  <span>报告人 {d.reporter}</span>
                  {d.fingerprint && <span>指纹 {d.fingerprint}</span>}
                  {d.environment && <span>环境 {d.environment}</span>}
                </div>
              </section>

              {/* 属性区：自定义字段 + 版本（M6） */}
              {(d.fields.length > 0 || d.release) && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">属性</h3>
                  <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
                    {d.release && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-28 shrink-0 text-xs text-slate-400">版本</span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                          {d.release.name}
                        </span>
                      </div>
                    )}
                    {d.fields.map((f) => (
                      <FieldRow
                        key={f.fieldId}
                        field={f}
                        disabled={busy}
                        onSaved={(v) =>
                          fieldAction
                            .run(() =>
                              api.put(`/v1/issues/${d.issueKey}/fields`, {
                                values: { [f.fieldId]: v },
                              }),
                            )
                            .then((r) => {
                              if (r !== undefined) reload();
                              return r;
                            })
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* 附件（M6） */}
              <section>
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-slate-400">
                    附件（≤20MB）
                  </h3>
                  <button
                    className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadAction.running}
                  >
                    <UploadOutlined aria-hidden />
                    {uploadAction.running ? '上传中…' : '上传附件'}
                  </button>
                </div>
                {uploadAction.error && <ErrorText>{uploadAction.error}</ErrorText>}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f);
                    e.target.value = '';
                  }}
                />
                <div className="space-y-1">
                  {d.attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm"
                    >
                      <PaperClipOutlined className="text-slate-400" aria-hidden />
                      <a
                        href={a.url}
                        className="min-w-0 flex-1 truncate text-sky-600 underline"
                        download={a.name}
                      >
                        {a.name}
                      </a>
                      <span className="text-xs text-slate-400">
                        {a.sizeBytes ? `${Math.ceil(a.sizeBytes / 1024)} KB · ` : ''}
                        {a.uploadedBy}
                      </span>
                      <button
                        className="rounded px-1.5 text-xs text-red-400 hover:bg-red-50"
                        title="删除附件"
                        onClick={() =>
                          void act(
                            () => api.del(`/v1/issues/${d.issueKey}/attachments/${a.id}`),
                            '附件已删除',
                          )
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  {d.attachments.length === 0 && (
                    <div className="text-xs text-slate-300">暂无附件</div>
                  )}
                </div>
              </section>

              {/* 工时（M6） */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">
                  工时（预计 {d.estimateMinutes ? `${d.estimateMinutes} 分钟` : '未设'} · 已登记{' '}
                  {d.worklogTotal} 分钟 = {Math.round((d.worklogTotal / 60) * 10) / 10} 小时）
                </h3>
                <div className="space-y-1">
                  {d.worklogs.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm"
                    >
                      <ActorChip name={w.actor} />
                      <span className="font-medium text-slate-600">{w.minutes} 分钟</span>
                      {w.comment && (
                        <span className="min-w-0 flex-1 truncate text-slate-400">{w.comment}</span>
                      )}
                      <span className="ml-auto text-xs text-slate-400">{timeAgo(w.spentAt)}</span>
                    </div>
                  ))}
                  {d.worklogs.length === 0 && (
                    <div className="text-xs text-slate-300">暂无工时</div>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={worklogMinutes}
                    onChange={(e) => setWorklogMinutes(e.target.value)}
                    placeholder="分钟"
                    className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={worklogComment}
                    onChange={(e) => setWorklogComment(e.target.value)}
                    placeholder="备注（可选）"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                  <button
                    disabled={!worklogMinutes || worklogAction.running}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    onClick={async () => {
                      const ok = await worklogAction.run(
                        () =>
                          api.post(`/v1/issues/${d.issueKey}/worklogs`, {
                            minutes: Number(worklogMinutes),
                            comment: worklogComment || undefined,
                          }),
                        '工时已登记',
                      );
                      if (ok !== undefined) {
                        setWorklogMinutes('');
                        setWorklogComment('');
                        reload();
                      }
                    }}
                  >
                    登记工时
                  </button>
                </div>
                {worklogAction.error && <ErrorText>{worklogAction.error}</ErrorText>}
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
                          className="mt-1 inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-xs text-sky-600 underline"
                        >
                          <PaperClipOutlined aria-hidden />
                          {a.name}
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

              {/* 评论（Markdown 渲染 + @提及） */}
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400">
                  评论（@账号名 可提醒成员；agent 的结构化证据也在这里）
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
                      <Markdown text={c.body} className="mt-1" />
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
                  <MentionTextarea
                    value={comment}
                    onChange={setComment}
                    members={detail.members}
                    placeholder="添加评论…支持 Markdown；输入 @ 唤起成员联想"
                    rows={2}
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

/**
 * 带 @成员联想的评论输入框：
 * 输入「@」或在 @ 后继续输入时弹出项目成员建议（匹配账号/姓名前缀），
 * ↑↓ 选择、Enter/Tab 补全、Esc 关闭；鼠标点击同样可补全。
 */
function MentionTextarea({
  value,
  onChange,
  members,
  placeholder,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  members: Array<{ name: string; displayName: string; avatarUrl: string | null }>;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // query.start = '@' 在文本中的下标；query.text = @ 之后的输入片段；null = 联想关闭
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [hi, setHi] = useState(0); // 高亮索引

  const items = query
    ? members
        .filter(
          (m) =>
            m.name.toLowerCase().startsWith(query.text.toLowerCase()) ||
            m.displayName.toLowerCase().includes(query.text.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  /** 从光标位置向前解析「@片段」：@ 必须在行首或前面是空白（避免命中邮箱）。 */
  const parse = (text: string, pos: number) => {
    const before = text.slice(0, pos);
    const m = /(^|\s)@([\w-]*)$/.exec(before);
    if (!m) return null;
    return { start: pos - m[2]!.length - 1, text: m[2]! };
  };

  const sync = (el: HTMLTextAreaElement) => {
    setQuery(parse(el.value, el.selectionStart ?? el.value.length));
    setHi(0);
  };

  const pick = (name: string) => {
    if (!query) return;
    const pos = (ref.current?.selectionStart ?? query.start + 1 + query.text.length);
    const next = `${value.slice(0, query.start)}@${name} ${value.slice(pos)}`;
    onChange(next);
    setQuery(null);
    // 光标落到补全文本之后
    const caret = query.start + name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.currentTarget);
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => sync(e.currentTarget)}
        onBlur={() => {
          // 点击建议项用 onMouseDown 抢在 blur 前完成，这里延迟关闭兜底
          window.setTimeout(() => setQuery(null), 150);
        }}
        onKeyDown={(e) => {
          if (!query || items.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => (h + 1) % items.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => (h - 1 + items.length) % items.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            pick(items[hi]!.name);
          } else if (e.key === 'Escape') {
            setQuery(null);
          }
        }}
      />
      {query && items.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
            选择要 @ 的成员（↑↓ 选择，Enter 补全）
          </p>
          {items.map((m, i) => (
            <button
              key={m.name}
              // onMouseDown 抢在 textarea blur 之前完成补全
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m.name);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                i === hi ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Avatar name={m.displayName || m.name} avatarUrl={m.avatarUrl} className="h-5 w-5" />
              <span className="font-mono text-xs">{m.name}</span>
              <span className="truncate text-xs text-slate-400">{m.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 自定义字段行内编辑（按类型渲染控件）。 */
function FieldRow({
  field,
  disabled,
  onSaved,
}: {
  field: IssueDetail['fields'][number];
  disabled: boolean;
  onSaved: (value: unknown) => Promise<unknown>;
}) {
  const options = (Array.isArray(field.options) ? field.options : []) as string[];
  const [text, setText] = useState(field.value == null ? '' : String(field.value));

  if (field.type === 'select') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-xs text-slate-400">{field.name}</span>
        <select
          className="rounded border border-slate-200 px-2 py-1 text-xs"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            void onSaved(e.target.value || null);
          }}
        >
          <option value="">（未设）</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-xs text-slate-400">{field.name}</span>
      <input
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (field.value == null ? '' : String(field.value)))
            void onSaved(field.type === 'number' ? Number(text) : text);
        }}
      />
    </div>
  );
}
