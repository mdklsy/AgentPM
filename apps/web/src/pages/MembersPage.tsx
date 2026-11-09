import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAction } from '../api/hooks.js';
import type { ActorType, MemberRole } from '../api/types.js';
import type { ProjectPageCtx } from './ProjectLayout.js';
import { ActorChip, Card, ErrorText, SuccessText, timeAgo } from '../components/ui.js';

interface ActorHit {
  name: string;
  displayName: string;
  type: ActorType;
  avatarUrl: string | null;
}

/** 成员管理：人与 agent 同列表；agent 用紫色标识，可看心跳；添加时从全局花名册搜索选人。 */
export function MembersPage() {
  const { projectKey, detail, reloadDetail } = useOutletContext<ProjectPageCtx>();
  const [actorName, setActorName] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const action = useAction();

  // 选人下拉：输入即搜（/v1/actors/search）
  const [hits, setHits] = useState<ActorHit[]>([]);
  const [openList, setOpenList] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openList) return;
    const t = setTimeout(() => {
      void api
        .get<{ actors: ActorHit[] }>(`/v1/actors/search?q=${encodeURIComponent(actorName)}`)
        .then((r) => setHits(r.actors))
        .catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(t);
  }, [actorName, openList]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const isAdmin = detail.myRole === 'OWNER' || detail.myRole === 'ADMIN';

  return (
    <div className="mx-auto max-w-3xl">
      {isAdmin && (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-44 flex-1" ref={boxRef}>
            <input
              value={actorName}
              onChange={(e) => {
                setActorName(e.target.value);
                setOpenList(true);
              }}
              onFocus={() => setOpenList(true)}
              placeholder="搜索成员（全局花名册：人或 agent）"
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
            {openList && hits.length > 0 && (
              <div className="absolute left-0 right-0 top-9 z-20 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {hits.map((h) => (
                  <button
                    key={h.name}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                    onClick={() => {
                      setActorName(h.name);
                      setOpenList(false);
                    }}
                  >
                    <ActorChip name={h.name} type={h.type} avatarUrl={h.avatarUrl} />
                    <span className="text-xs text-slate-400">{h.displayName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
            <ActorChip name={m.name} type={m.type} avatarUrl={m.avatarUrl} />
            <span className="text-slate-600">{m.displayName}</span>
            {isAdmin && m.role !== 'OWNER' ? (
              <select
                value={m.role}
                onChange={async (e) => {
                  const next = e.target.value as MemberRole;
                  const ok = await action.run(
                    () => api.patch(`/v1/projects/${projectKey}/members/${m.name}`, { role: next }),
                    `${m.name} 角色已改为 ${next}`,
                  );
                  if (ok !== undefined) reloadDetail();
                }}
                className="rounded border border-slate-200 px-1.5 py-0.5 text-xs"
              >
                {(['ADMIN', 'MEMBER', 'AGENT', 'VIEWER'] as const).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            ) : (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {m.role}
              </span>
            )}
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
