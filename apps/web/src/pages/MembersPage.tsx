import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAction } from '../api/hooks.js';
import type { MemberRole } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { ActorChip, Card, ErrorText, SuccessText, timeAgo } from '../components/ui.js';

/** 成员管理：人与 agent 同列表；agent 用紫色标识，可看心跳 */
export function MembersPage() {
  const { projectKey, detail, reloadDetail } = useOutletContext<ProjectPageCtx>();
  const [actorName, setActorName] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const action = useAction();

  const isAdmin = detail.myRole === 'OWNER' || detail.myRole === 'ADMIN';

  return (
    <div className="mx-auto max-w-3xl">
      {isAdmin && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <input
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="账号名（人类或 agent）"
            className="min-w-44 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          >
            {(['ADMIN', 'MEMBER', 'AGENT', 'VIEWER'] as const).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button
            disabled={!actorName.trim() || action.running}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={async () => {
              const ok = await action.run(
                () => api.post(`/v1/projects/${projectKey}/members`, { actorName, role }),
                `已添加 ${actorName}（${role}）`,
              );
              if (ok !== undefined) {
                setActorName('');
                reloadDetail();
              }
            }}
          >
            + 添加成员
          </button>
        </Card>
      )}
      {action.error && (
        <div className="mb-2">
          <ErrorText>{action.error}</ErrorText>
        </div>
      )}
      {action.message && (
        <div className="mb-2">
          <SuccessText>{action.message}</SuccessText>
        </div>
      )}

      <div className="space-y-2">
        {detail.members.map((m) => (
          <Card key={m.name} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <ActorChip name={m.name} type={m.type} />
            <span className="text-slate-600">{m.displayName}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {m.role}
            </span>
            {m.type !== 'HUMAN' && (
              <span className="text-xs text-slate-400">
                {m.lastHeartbeatAt ? `心跳 ${timeAgo(m.lastHeartbeatAt)}` : '无心跳'}
              </span>
            )}
            {!m.isActive && <span className="text-xs text-red-400">已停用</span>}
            {isAdmin && m.role !== 'OWNER' && (
              <button
                className="ml-auto rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                onClick={async () => {
                  const ok = await action.run(
                    () => api.del(`/v1/projects/${projectKey}/members/${m.name}`),
                    `已移除 ${m.name}`,
                  );
                  if (ok !== undefined) reloadDetail();
                }}
              >
                移除
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
