import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { Priority } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import {
  ActorChip,
  EmptyState,
  ErrorText,
  PriorityBadge,
  Spinner,
  SuccessText,
  TypeBadge,
} from '../components/ui.js';

interface BacklogItem {
  issueKey: string;
  title: string;
  type: string;
  priority: string;
  state: string;
  assignee: string | null;
  labels: string[];
}

/** Backlog（M6 扩展）：CSV 导出/导入 + 批量操作（指派/优先级/流转）。 */
export function BacklogPage() {
  const { projectKey, detail, openIssue, reloadDetail } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error, reload } = useApi<{ backlog: BacklogItem[] }>(
    `/v1/projects/${projectKey}/backlog`,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<string | null>(null);
  const bulkAction = useAction();
  const csvAction = useAction();
  const csvFileRef = useRef<HTMLInputElement>(null);

  const items = data?.backlog ?? [];
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const selectAll = () =>
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.issueKey)));

  const bulk = async (payload: Record<string, unknown>, label: string) => {
    const r = await bulkAction.run<{
      results: Array<{ ok: boolean; error?: string }>;
      okCount: number;
    }>(() =>
      api.post(`/v1/projects/${projectKey}/issues/bulk`, { issueKeys: [...selected], ...payload }),
    );
    if (r) {
      const failed = r.results.filter((x) => !x.ok);
      setTip(
        `${label}：成功 ${r.okCount}${failed.length ? ` · 失败 ${failed.length}（${failed[0]!.error ?? ''}）` : ''}`,
      );
      setSelected(new Set());
      reload();
      reloadDetail();
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const r = await csvAction.run<{
      created: number;
      failed: Array<{ row: number; error: string }>;
    }>(() => api.post(`/v1/projects/${projectKey}/issues/import`, { csv: text }));
    if (r) {
      setTip(
        `导入完成：新建 ${r.created} 个${r.failed.length ? ` · 失败 ${r.failed.length}（第 ${r.failed[0]!.row} 行：${r.failed[0]!.error}）` : ''}`,
      );
      reload();
      reloadDetail();
    }
  };

  const canEdit = detail.myRole !== 'VIEWER';
  const workflow = detail.workflows.find((w) => w.issueType === 'TASK');

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">
          未排期（无 Sprint）且未完成的 issue。这是 agent{' '}
          <code className="rounded bg-white px-1">issue.claim</code> 抢单的主要池子。
        </p>
        <span className="ml-auto flex items-center gap-2">
          <a
            href={`/v1/projects/${projectKey}/issues.csv`}
            download
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            title="导出当前项目全部 issue（CSV）"
          >
            <DownloadOutlined aria-hidden />
            导出 CSV
          </a>
          {canEdit && (
            <>
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                onClick={() => csvFileRef.current?.click()}
                disabled={csvAction.running}
              >
                <UploadOutlined aria-hidden />
                {csvAction.running ? '导入中…' : '导入 CSV'}
              </button>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCsv(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </span>
      </div>
      {csvAction.error && <ErrorText>{csvAction.error}</ErrorText>}
      {tip && <SuccessText>{tip}</SuccessText>}

      {loading && <Spinner />}
      {error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && items.length === 0 && (
        <EmptyState>Backlog 为空——未排期的未完成 issue 会出现在这里</EmptyState>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={selected.size === items.length && items.length > 0}
              onChange={selectAll}
              aria-label="全选"
            />
            全选（{items.length}）
          </div>
          {items.map((i) => (
            <div
              key={i.issueKey}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm hover:shadow-md"
            >
              <input
                type="checkbox"
                checked={selected.has(i.issueKey)}
                onChange={() => toggle(i.issueKey)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`选择 ${i.issueKey}`}
              />
              <TypeBadge type={i.type as never} />
              <PriorityBadge priority={i.priority as never} />
              <span className="font-mono text-xs text-slate-400">{i.issueKey}</span>
              <span
                className="flex-1 truncate text-slate-700"
                onClick={() => openIssue(i.issueKey)}
              >
                {i.title}
              </span>
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
        </>
      )}

      {/* 批量操作条 */}
      {canEdit && selected.size > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-white p-3 shadow-lg">
          <span className="text-sm font-medium text-indigo-700">已选 {selected.size} 项：</span>
          <select
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) void bulk({ action: 'assign', assigneeName: v || null }, '批量指派');
              e.target.value = '';
            }}
          >
            <option value="">指派给…</option>
            <option value="(clear)">（取消指派）</option>
            {detail.members.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                void bulk({ action: 'priority', priority: e.target.value }, '批量改优先级');
              e.target.value = '';
            }}
          >
            <option value="">优先级…</option>
            {(['P0', 'P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {workflow && (
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value)
                  void bulk({ action: 'transition', toState: e.target.value }, '批量流转');
                e.target.value = '';
              }}
            >
              <option value="">流转到…</option>
              {workflow.states.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </button>
        </div>
      )}
      {bulkAction.error && <ErrorText>{bulkAction.error}</ErrorText>}
    </div>
  );
}
