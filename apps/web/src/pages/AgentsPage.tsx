import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { AgentItem } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import {
  ActorChip,
  Card,
  ErrorText,
  Modal,
  SuccessText,
  Spinner,
  timeAgo,
} from '../components/ui.js';

/** 独立机器人管理（可选）：给第三方 bot 建立隔离身份（独立 token/信誉/心跳）。
 * 日常自动化无需来这里——直接在团队成员页用你本人的个人 Token 接入 MCP。 */
export function AgentsPage() {
  const { projectKey, detail, reloadDetail } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error, reload } = useApi<{ agents: AgentItem[] }>('/v1/agents');
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);
  const create = useAction();
  const join = useAction();
  const [form, setForm] = useState({ name: '', description: '', model: '' });

  const memberNames = new Set(detail.members.map((m) => m.name));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-700">独立机器人（可选）</h2>
          <p className="text-xs text-slate-400">
            给第三方 bot 建立隔离身份：独立 token、独立信誉分、独立心跳。
            日常自动化请直接用你本人的个人 Token（团队成员页），无需创建机器人。
          </p>
        </div>
        <button
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700"
          onClick={() => setCreating(true)}
        >
          + 创建独立机器人
        </button>
      </div>

      {loading && <Spinner />}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.agents.map((a) => {
          const inProject = memberNames.has(a.name);
          return (
            <Card key={a.id} className="p-4">
              <div className="flex items-center gap-2">
                <ActorChip name={a.name} type="AGENT" />
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    a.agentProfile.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {a.agentProfile.status}
                </span>
                {a.agentProfile.model && (
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500">
                    {a.agentProfile.model}
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400">
                  {a.agentProfile.lastHeartbeatAt
                    ? `心跳 ${timeAgo(a.agentProfile.lastHeartbeatAt)}`
                    : '无心跳'}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                {a.agentProfile.description}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-400">owner {a.agentProfile.owner.name}</span>
                {inProject ? (
                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                    已在本项目
                  </span>
                ) : (
                  <button
                    className="ml-auto rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                    onClick={async () => {
                      const ok = await join.run(
                        () =>
                          api.post(`/v1/projects/${projectKey}/members`, {
                            actorName: a.name,
                            role: 'AGENT',
                          }),
                        `${a.name} 已加入项目（AGENT 角色）`,
                      );
                      if (ok !== undefined) reloadDetail();
                    }}
                  >
                    + 加入本项目
                  </button>
                )}
              </div>
              {a.agentProfile.capabilities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.agentProfile.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {join.error && (
        <div className="mt-2">
          <ErrorText>{join.error}</ErrorText>
        </div>
      )}
      {join.message && (
        <div className="mt-2">
          <SuccessText>{join.message}</SuccessText>
        </div>
      )}

      {creating && (
        <Modal title="创建 Agent" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
              placeholder="agent 名称（小写，如 code-bot）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="职责描述（它擅长什么）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="底层模型（可选，如 glm-4.7）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {create.error && <ErrorText>{create.error}</ErrorText>}
            <button
              disabled={!form.name.trim() || !form.description.trim() || create.running}
              className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              onClick={async () => {
                const r = await create.run(() =>
                  api.post<{ agent: { name: string }; token: string }>('/v1/agents', {
                    name: form.name,
                    description: form.description,
                    model: form.model || undefined,
                  }),
                );
                if (r) {
                  setMinted({ name: r.agent.name, token: r.token });
                  setCreating(false);
                  reload();
                }
              }}
            >
              创建并签发 token
            </button>
          </div>
        </Modal>
      )}

      {minted && (
        <Modal
          title={`Agent ${minted.name} 的 token（仅此一次）`}
          onClose={() => setMinted(null)}
          wide
        >
          <SuccessText>请立即复制保存，关闭后无法再次查看。</SuccessText>
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">
            {minted.token}
          </pre>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p className="mb-1 font-semibold">MCP 接入方式（任选其一）：</p>
            <p>
              1. Streamable HTTP：POST /v1/mcp，Authorization: Bearer {minted.token.slice(0, 12)}…
            </p>
            <p>
              2. stdio 网关：node apps/mcp-stdio/src/main.ts --url http://host:3000/v1/mcp --token{' '}
              {'<token>'}
            </p>
            <p className="mt-1">别忘了把 {minted.name} 加入项目（AGENT 角色）它才能操作。</p>
          </div>
          <button
            className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() =>
              void navigator.clipboard.writeText(minted.token).then(() => setMinted(null))
            }
          >
            复制并关闭
          </button>
        </Modal>
      )}
    </div>
  );
}
