import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { qs } from '../api/client.js';
import type { IssueListItem, IssueType, ProjectDetail } from '../api/types.js';
import { PriorityBadge, TypeBadge, CATEGORY_COLOR, ActorChip } from './ui.js';

const TYPES: IssueType[] = ['TASK', 'STORY', 'BUG', 'EPIC', 'SUBTASK'];

/**
 * 看板：列 = 当前 issue 类型工作流的状态（按序）；
 * 卡片支持 HTML5 拖拽到其他列触发流转；点击卡片打开详情抽屉。
 */
export function KanbanBoard({
  detail,
  issues,
  onChanged,
  onOpenIssue,
}: {
  detail: ProjectDetail;
  issues: IssueListItem[];
  onChanged: () => void;
  onOpenIssue: (issueKey: string) => void;
}) {
  const [type, setType] = useState<IssueType>('TASK');
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workflow = useMemo(
    () => detail.workflows.find((w) => w.issueType === type) ?? detail.workflows[0]!,
    [detail.workflows, type],
  );

  const byState = useMemo(() => {
    const map = new Map<string, IssueListItem[]>();
    for (const s of workflow.states) map.set(s.name, []);
    for (const i of issues) {
      if (i.type !== type) continue;
      (map.get(i.state) ?? map.set(i.state, []).get(i.state)!).push(i);
    }
    return map;
  }, [issues, workflow.states, type]);

  const drop = async (toState: string) => {
    setDropTarget(null);
    const key = dragKey;
    setDragKey(null);
    if (!key) return;
    const issue = issues.find((i) => i.issueKey === key);
    if (!issue || issue.state === toState) return;
    try {
      const r = await api.post(`/v1/issues/${key}/transition`, { toState });
      setError(
        (r as { status?: string; message?: string }).status === 'pending_approval'
          ? `已提交审批：${(r as { message: string }).message}`
          : null,
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onChanged();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              type === t
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto text-xs text-slate-400">拖拽卡片到目标列即可流转状态</div>
      </div>
      {error && (
        <div
          className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}
      <div className="flex flex-1 gap-3 overflow-x-auto pb-3">
        {workflow.states.map((state) => {
          const cards = byState.get(state.name) ?? [];
          return (
            <div
              key={state.name}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(state.name);
              }}
              onDragLeave={() => setDropTarget((t) => (t === state.name ? null : t))}
              onDrop={() => void drop(state.name)}
              className={`flex min-w-64 flex-1 flex-col rounded-xl border border-slate-200 border-t-4 bg-slate-50/60 ${
                CATEGORY_COLOR[state.category]
              } ${dropTarget === state.name ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-semibold text-slate-600">{state.name}</span>
                <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-500">
                  {cards.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {cards.map((i) => (
                  <div
                    key={i.issueKey}
                    draggable
                    onDragStart={() => setDragKey(i.issueKey)}
                    onDragEnd={() => setDragKey(null)}
                    onClick={() => onOpenIssue(i.issueKey)}
                    className={`cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition hover:shadow-md ${
                      dragKey === i.issueKey ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <TypeBadge type={i.type} />
                      <PriorityBadge priority={i.priority} />
                      {i.labels.slice(0, 2).map((l) => (
                        <span
                          key={l}
                          className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                    <div className="line-clamp-2 text-sm text-slate-700">{i.title}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-400">{i.issueKey}</span>
                      {i.assignee ? (
                        <ActorChip name={i.assignee} />
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                          可领取
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-300">
                    空
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const boardSearch = (projectKey: string, type?: IssueType) =>
  `/v1/projects/${projectKey}/issues${qs({ type, pageSize: 100, sort: 'priority_asc' })}`;
