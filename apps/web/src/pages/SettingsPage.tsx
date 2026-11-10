import { useEffect, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { CustomFieldItem, IssueType, ReleaseItem, WorkflowEditorData } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { Card, EmptyState, ErrorText, Modal, Spinner, SuccessText } from '../components/ui.js';
import { useOutletContext } from 'react-router-dom';

/** 项目设置（M6）：自定义字段 / 版本管理 / 工作流编辑器。写操作需 ADMIN+。 */

const FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;
const ISSUE_TYPES: IssueType[] = ['TASK', 'STORY', 'BUG', 'EPIC', 'SUBTASK'];
const CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
const RELEASE_STATUS: Array<ReleaseItem['status']> = ['planned', 'released', 'archived'];
const STATUS_CN: Record<ReleaseItem['status'], string> = {
  planned: '规划中',
  released: '已发布',
  archived: '已归档',
};
const CATEGORY_CN: Record<(typeof CATEGORIES)[number], string> = {
  TODO: '待办',
  IN_PROGRESS: '进行中',
  DONE: '完成',
};

/* ---------------- 自定义字段 ---------------- */

function FieldsCard() {
  const { projectKey, detail } = useOutletContext<ProjectPageCtx>();
  const fields = useApi<{ fields: CustomFieldItem[] }>(`/v1/projects/${projectKey}/fields`);
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; type: string; options: string }>({
    name: '',
    type: 'text',
    options: '',
  });
  const canEdit = detail.myRole === 'OWNER' || detail.myRole === 'ADMIN';

  const create = async () => {
    const ok = await action.run(
      () =>
        api.post(`/v1/projects/${projectKey}/fields`, {
          name: form.name,
          type: form.type,
          ...(form.type === 'select'
            ? {
                options: form.options
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      '字段已创建',
    );
    if (ok !== undefined) {
      setCreating(false);
      setForm({ name: '', type: 'text', options: '' });
      fields.reload();
    }
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold text-slate-800">自定义字段</h2>
      <p className="mb-3 text-xs text-slate-400">
        给 issue 加项目专属的属性（ADMIN 可管理），在 Issue 抽屉里填写
      </p>
      {action.error && <ErrorText>{action.error}</ErrorText>}
      {action.message && <SuccessText>{action.message}</SuccessText>}
      {fields.loading && <Spinner />}
      {fields.error && <ErrorText>{fields.error}</ErrorText>}
      {fields.data && fields.data.fields.length === 0 && <EmptyState>还没有自定义字段</EmptyState>}
      {fields.data && fields.data.fields.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1.5">名称</th>
              <th>类型</th>
              <th>选项</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.data.fields.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="py-2 font-medium text-slate-700">{f.name}</td>
                <td className="text-slate-500">
                  {{ text: '文本', number: '数字', date: '日期', select: '单选' }[f.type]}
                </td>
                <td className="text-xs text-slate-400">
                  {f.type === 'select'
                    ? Array.isArray(f.options)
                      ? (f.options as string[]).join(' / ')
                      : ''
                    : '—'}
                </td>
                <td className="text-right">
                  {canEdit && (
                    <button
                      className="text-slate-300 hover:text-red-500"
                      title="删除字段（连同所有 issue 上已填的值）"
                      onClick={async () => {
                        if (!confirm(`删除字段「${f.name}」？已填的值会一并清除。`)) return;
                        await action
                          .run(() => api.del(`/v1/projects/${projectKey}/fields/${f.id}`), '已删除')
                          .then((r) => {
                            if (r !== undefined) fields.reload();
                            return r;
                          });
                      }}
                    >
                      <DeleteOutlined aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <button
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          onClick={() => setCreating(true)}
        >
          <PlusOutlined aria-hidden /> 新建字段
        </button>
      )}

      {creating && (
        <Modal title="新建自定义字段" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="字段名（如：验收标准、风险等级）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {{ text: '文本', number: '数字', date: '日期', select: '单选' }[t]}
                </option>
              ))}
            </select>
            {form.type === 'select' && (
              <input
                value={form.options}
                onChange={(e) => setForm({ ...form, options: e.target.value })}
                placeholder="选项，用逗号分隔（如：高,中,低）"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            )}
            <button
              disabled={!form.name.trim() || action.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => void create()}
            >
              创建
            </button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- 版本管理 ---------------- */

function ReleasesCard() {
  const { projectKey, detail } = useOutletContext<ProjectPageCtx>();
  const releases = useApi<{ releases: ReleaseItem[] }>(`/v1/projects/${projectKey}/releases`);
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const canEdit = detail.myRole === 'OWNER' || detail.myRole === 'ADMIN';

  const create = async () => {
    const ok = await action.run(
      () =>
        api.post(`/v1/projects/${projectKey}/releases`, {
          name,
          releaseDate: date || null,
        }),
      '版本已创建',
    );
    if (ok !== undefined) {
      setCreating(false);
      setName('');
      setDate('');
      releases.reload();
    }
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold text-slate-800">版本（Release）</h2>
      <p className="mb-3 text-xs text-slate-400">把 issue 归入一个发布版本，跟踪每个版本的完成度</p>
      {action.error && <ErrorText>{action.error}</ErrorText>}
      {action.message && <SuccessText>{action.message}</SuccessText>}
      {releases.loading && <Spinner />}
      {releases.error && <ErrorText>{releases.error}</ErrorText>}
      {releases.data && releases.data.releases.length === 0 && (
        <EmptyState>还没有版本——发布前把相关 issue 归到一个版本里</EmptyState>
      )}
      {releases.data && releases.data.releases.length > 0 && (
        <div className="space-y-2">
          {releases.data.releases.map((r) => {
            const pct = r.totalIssues > 0 ? Math.round((r.doneIssues / r.totalIssues) * 100) : 0;
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-semibold text-slate-700">{r.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    r.status === 'released'
                      ? 'bg-emerald-100 text-emerald-700'
                      : r.status === 'archived'
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-indigo-50 text-indigo-600'
                  }`}
                >
                  {STATUS_CN[r.status]}
                </span>
                {r.releaseDate && (
                  <span className="text-xs text-slate-400">
                    发布日 {r.releaseDate.slice(0, 10)}
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  {r.doneIssues}/{r.totalIssues} 完成
                </span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {canEdit && (
                    <select
                      value={r.status}
                      className="rounded border border-slate-200 px-1.5 py-1 text-xs"
                      onChange={async (e) => {
                        await action
                          .run(
                            () =>
                              api.patch(`/v1/projects/${projectKey}/releases/${r.id}`, {
                                status: e.target.value,
                              }),
                            '状态已更新',
                          )
                          .then((res) => {
                            if (res !== undefined) releases.reload();
                            return res;
                          });
                      }}
                    >
                      {RELEASE_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_CN[s]}
                        </option>
                      ))}
                    </select>
                  )}
                  {canEdit && (
                    <button
                      className="text-slate-300 hover:text-red-500"
                      title="删除版本（issue 不受影响，只是脱离版本）"
                      onClick={async () => {
                        if (!confirm(`删除版本「${r.name}」？`)) return;
                        await action
                          .run(
                            () => api.del(`/v1/projects/${projectKey}/releases/${r.id}`),
                            '已删除',
                          )
                          .then((res) => {
                            if (res !== undefined) releases.reload();
                            return res;
                          });
                      }}
                    >
                      <DeleteOutlined aria-hidden />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (
        <button
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          onClick={() => setCreating(true)}
        >
          <PlusOutlined aria-hidden /> 新建版本
        </button>
      )}

      {creating && (
        <Modal title="新建版本" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="版本名（如：v1.2.0）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              disabled={!name.trim() || action.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => void create()}
            >
              创建
            </button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- 工作流编辑器 ---------------- */

interface StateRow {
  id?: string;
  name: string;
  category: (typeof CATEGORIES)[number];
  isInitial: boolean;
}

function WorkflowEditorCard() {
  const { projectKey, detail } = useOutletContext<ProjectPageCtx>();
  const [issueType, setIssueType] = useState<IssueType>('TASK');
  const wf = useApi<WorkflowEditorData>(`/v1/projects/${projectKey}/workflows/${issueType}`);
  const [rows, setRows] = useState<StateRow[]>([]);
  const [matrix, setMatrix] = useState<Set<string>>(new Set()); // "from\u0000to"，from 空 = 创建入口
  const action = useAction();
  const canEdit = detail.myRole === 'OWNER' || detail.myRole === 'ADMIN';

  // 载入/切换 issue 类型时，把服务端数据拷进本地编辑态
  useEffect(() => {
    if (!wf.data) return;
    setRows(
      wf.data.states.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        isInitial: s.isInitial,
      })),
    );
    setMatrix(new Set(wf.data.transitions.map((t) => `${t.from ?? ''}\u0000${t.to}`)));
  }, [wf.data]);

  const rowKey = (r: StateRow, i: number) => r.id ?? `new:${i}`;

  const updateRow = (i: number, patch: Partial<StateRow>) => {
    setRows((rs) =>
      rs.map((r, idx) => {
        const next = idx === i ? { ...r, ...patch } : r;
        // 初始态互斥：设某个为初始时其余取消
        if (patch.isInitial && idx !== i) return { ...next, isInitial: false };
        return next;
      }),
    );
  };

  const removeRow = (i: number) => {
    const victim = rows[i]!;
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setMatrix((m) => {
      const next = new Set<string>();
      for (const k of m) {
        const [f, t] = k.split('\u0000');
        if (f === victim.name || t === victim.name) continue;
        next.add(k);
      }
      return next;
    });
  };

  const toggleEdge = (from: string, to: string) => {
    const k = `${from}\u0000${to}`;
    setMatrix((m) => {
      const next = new Set(m);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    const ok = await action.run(
      () =>
        api.put(`/v1/projects/${projectKey}/workflows/${issueType}`, {
          states: rows.map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: r.name,
            category: r.category,
            isInitial: r.isInitial,
          })),
          transitions: [...matrix].map((k) => {
            const [f, t] = k.split('\u0000');
            return [f || null, t];
          }),
        }),
      '工作流已保存，看板列即时生效',
    );
    if (ok !== undefined) wf.reload();
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold text-slate-800">工作流编辑器</h2>
      <p className="mb-3 text-xs text-slate-400">
        每个 issue 类型一条流程：状态 + 允许的流转。改完保存，看板列即时变化
      </p>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-slate-400">_issue 类型：</span>
        {ISSUE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setIssueType(t)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              issueType === t
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {wf.loading && <Spinner />}
      {wf.error && <ErrorText>{wf.error}</ErrorText>}

      {wf.data && (
        <>
          {action.error && <ErrorText>{action.error}</ErrorText>}
          {action.message && <SuccessText>{action.message}</SuccessText>}

          {/* 状态行 */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="w-16 py-1">初始</th>
                <th>状态名</th>
                <th className="w-28">类别</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={rowKey(r, i)} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <input
                      type="radio"
                      name="wf-initial"
                      checked={r.isInitial}
                      onChange={() => updateRow(i, { isInitial: true })}
                      aria-label={`设 ${r.name} 为初始状态`}
                    />
                  </td>
                  <td>
                    <input
                      value={r.name}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                      className="w-40 rounded border border-slate-200 px-2 py-1 text-sm"
                    />
                  </td>
                  <td>
                    <select
                      value={r.category}
                      onChange={(e) =>
                        updateRow(i, { category: e.target.value as StateRow['category'] })
                      }
                      className="rounded border border-slate-200 px-1.5 py-1 text-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_CN[c]}（{c}）
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right">
                    {rows.length > 2 && (
                      <button
                        className="text-slate-300 hover:text-red-500"
                        title="删除状态（若已有 issue 处于该状态，保存会被拒绝）"
                        onClick={() => removeRow(i)}
                      >
                        <DeleteOutlined aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { name: `新状态${rs.length}`, category: 'TODO', isInitial: false },
              ])
            }
          >
            <PlusOutlined aria-hidden /> 加状态
          </button>

          {/* 迁移矩阵 */}
          <p className="mt-4 mb-1.5 text-xs font-semibold text-slate-500">
            允许的流转（行 → 列；「创建」行表示新建 issue 可直接进入该状态）
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-xs text-slate-300">from \ to</th>
                  {rows.map((r, j) => (
                    <th key={`h${rowKey(r, j)}`} className="px-2 py-1 text-xs text-slate-500">
                      {r.name || '?'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="px-2 py-1.5 text-xs text-slate-400">创建</td>
                  {rows.map((r, j) => (
                    <td key={`c0${rowKey(r, j)}`} className="text-center">
                      <input
                        type="checkbox"
                        checked={matrix.has(`\u0000${r.name}`)}
                        disabled={!canEdit}
                        onChange={() => toggleEdge('', r.name)}
                        aria-label={`创建后进入 ${r.name}`}
                      />
                    </td>
                  ))}
                </tr>
                {rows.map((r, i) => (
                  <tr key={`r${rowKey(r, i)}`} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 text-xs text-slate-500">{r.name || '?'}</td>
                    {rows.map((t, j) => (
                      <td key={`c${i}-${j}`} className="text-center">
                        {i === j ? (
                          <span className="text-slate-200">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={matrix.has(`${r.name}\u0000${t.name}`)}
                            disabled={!canEdit}
                            onChange={() => toggleEdge(r.name, t.name)}
                            aria-label={`${r.name} 流转到 ${t.name}`}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <button
              disabled={action.running}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => void save()}
            >
              保存工作流
            </button>
          )}
          <p className="mt-1.5 text-[11px] text-slate-300">
            提示：状态被已有 issue 占用时无法删除；初始状态必须恰好一个；同名状态不允许重复。
          </p>
        </>
      )}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FieldsCard />
      <ReleasesCard />
      <WorkflowEditorCard />
    </div>
  );
}
