import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import type { ActorType } from '../api/types.js';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorText,
  Modal,
  Spinner,
  SuccessText,
  timeAgo,
} from '../components/ui.js';
import { useAuth } from '../auth.js';

/**
 * 团队成员（M5.5）：实例级花名册，独立于项目。
 * 管理员：增删改、重置密码、启停、管理员开关、传头像；所有人：自己的头像与 API Token。
 */

interface UserRow {
  name: string;
  displayName: string;
  type: ActorType;
  avatarUrl?: string | null;
  email?: string | null;
  isAdmin?: boolean;
  isActive?: boolean;
  mustChangePassword?: boolean;
  hasPassword?: boolean;
  createdAt?: string;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<ActorType, string> = {
  HUMAN: '人类',
  AGENT: 'Agent',
  AVATAR: 'PM 替身',
};

/** 读图 → 压到 128px 方图 → data URL（jpeg ~几十 KB，省库省带宽）。 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function TeamPage() {
  const { me, refresh } = useAuth();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ActorType>('ALL');
  const users = useApi<{ users: UserRow[] }>(
    `/v1/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(typeFilter !== 'ALL' ? { type: typeFilter } : {}) })}`,
  );
  const action = useAction();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarTarget = useRef<string>('');

  const isAdmin = me?.isAdmin ?? false;

  const uploadAvatar = async (file: File) => {
    const dataUrl = await fileToAvatarDataUrl(file);
    const ok = await action.run(
      () => api.post(`/v1/users/${avatarTarget.current}/avatar`, { dataUrl }),
      '头像已更新',
    );
    if (ok !== undefined) {
      users.reload();
      if (avatarTarget.current === me?.name) void refresh();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
        >
          ← 我的项目
        </Link>
        <span className="flex items-center gap-1.5 font-semibold text-slate-800">
          <TeamOutlined aria-hidden />
          团队成员
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-sm text-slate-500">
          <Avatar name={me?.displayName ?? ''} avatarUrl={me?.avatarUrl} className="h-6 w-6" />
          {me?.displayName}
        </span>
      </header>

      <div className="mx-auto max-w-4xl space-y-4 p-6">
        {action.error && <ErrorText>{action.error}</ErrorText>}
        {action.message && <SuccessText>{action.message}</SuccessText>}

        {/* 花名册 */}
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-800">花名册</h2>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索账号或姓名…"
              className="ml-2 w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'ALL' | ActorType)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="ALL">全部类型</option>
              <option value="HUMAN">人类</option>
              <option value="AGENT">Agent</option>
              <option value="AVATAR">PM 替身</option>
            </select>
            {isAdmin && (
              <button
                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                onClick={() => setCreating(true)}
              >
                <PlusOutlined aria-hidden />
                添加用户
              </button>
            )}
          </div>

          {users.loading && <Spinner />}
          {users.error && <ErrorText>{users.error}</ErrorText>}
          {users.data && users.data.users.length === 0 && <EmptyState>没有匹配的成员</EmptyState>}
          <div className="space-y-2">
            {users.data?.users.map((u) => (
              <div
                key={u.name}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"
              >
                <button
                  title={u.name === me?.name || isAdmin ? '点击更换头像' : undefined}
                  onClick={() => {
                    if (u.name !== me?.name && !isAdmin) return;
                    avatarTarget.current = u.name;
                    fileRef.current?.click();
                  }}
                  className="shrink-0"
                >
                  <Avatar
                    name={u.displayName || u.name}
                    avatarUrl={u.avatarUrl}
                    className="h-9 w-9"
                  />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{u.name}</span>
                    {u.isAdmin && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        管理员
                      </span>
                    )}
                    {u.isActive === false && <span className="text-xs text-red-400">已停用</span>}
                    {u.mustChangePassword && (
                      <span className="text-xs text-orange-400">待改密</span>
                    )}
                  </div>
                  <div className="truncate text-slate-700">{u.displayName}</div>
                  {u.email && isAdmin && (
                    <div className="truncate text-xs text-slate-400">{u.email}</div>
                  )}
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    u.type === 'HUMAN'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-violet-100 text-violet-700'
                  }`}
                >
                  {TYPE_LABEL[u.type]}
                </span>
                {u.createdAt && (
                  <span className="ml-auto hidden text-xs text-slate-400 sm:inline">
                    加入于 {timeAgo(u.createdAt)}
                  </span>
                )}
                {isAdmin && u.type === 'HUMAN' && (
                  <button
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    onClick={() => setEditing(u)}
                  >
                    <EditOutlined aria-hidden />
                    编辑
                  </button>
                )}
              </div>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAvatar(f);
              e.target.value = '';
            }}
          />
        </Card>

        {/* 我的 API Token */}
        <TokenCard onMinted={setMintedToken} />
      </div>

      {/* 添加用户 */}
      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(token) => {
            setCreating(false);
            users.reload();
            if (token) setMintedToken(token);
          }}
        />
      )}

      {/* 编辑用户 */}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            users.reload();
          }}
        />
      )}

      {/* 一次性明文 token */}
      {mintedToken && (
        <Modal title="token 仅此一次显示" onClose={() => setMintedToken(null)}>
          <SuccessText>请立即复制保存（关闭后无法再查看）</SuccessText>
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">
            {mintedToken}
          </pre>
          <button
            className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() =>
              void navigator.clipboard.writeText(mintedToken).then(() => setMintedToken(null))
            }
          >
            复制并关闭
          </button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 添加用户 ---------------- */

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: string | null) => void;
}) {
  const create = useAction();
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    email: '',
    password: '',
    isAdmin: false,
    mustChangePassword: true,
  });

  return (
    <Modal title="添加用户" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
          placeholder="账号名（小写字母开头，仅字母/数字/中划线，如 wang-mei）"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          placeholder="姓名/显示名"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="邮箱（可选）"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="初始密码（≥8 位）"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={form.isAdmin}
            onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
          />
          设为实例管理员（可管理全部项目设置与用户）
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={form.mustChangePassword}
            onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })}
          />
          首次登录强制改密
        </label>
        {create.error && <ErrorText>{create.error}</ErrorText>}
        <button
          disabled={
            !form.name.trim() ||
            !form.displayName.trim() ||
            form.password.length < 8 ||
            create.running
          }
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          onClick={async () => {
            const r = await create.run(() =>
              api.post<{ user: UserRow }>('/v1/users', {
                name: form.name,
                displayName: form.displayName,
                ...(form.email ? { email: form.email } : {}),
                password: form.password,
                isAdmin: form.isAdmin,
                mustChangePassword: form.mustChangePassword,
              }),
            );
            if (r) onCreated(null);
          }}
        >
          创建
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 编辑用户 ---------------- */

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useAuth();
  const save = useAction();
  const [form, setForm] = useState({
    displayName: user.displayName,
    email: user.email ?? '',
    isAdmin: user.isAdmin ?? false,
    isActive: user.isActive ?? true,
    newPassword: '',
  });

  return (
    <Modal title={`编辑 ${user.name}`} onClose={onClose}>
      <div className="space-y-3">
        <input
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          placeholder="姓名/显示名"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="邮箱"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          placeholder="重置密码（留空表示不改；重置后需首次登录改密）"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        {user.name !== me?.name && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
              />
              实例管理员
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              启用账号（停用后无法登录、token 失效）
            </label>
          </>
        )}
        {save.error && <ErrorText>{save.error}</ErrorText>}
        <button
          disabled={save.running}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          onClick={async () => {
            const r = await save.run(() =>
              api.patch<{ user: UserRow }>(`/v1/users/${user.name}`, {
                displayName: form.displayName,
                email: form.email || null,
                ...(user.name !== me?.name
                  ? { isAdmin: form.isAdmin, isActive: form.isActive }
                  : {}),
                ...(form.newPassword ? { newPassword: form.newPassword } : {}),
              }),
            );
            if (r) onSaved();
          }}
        >
          保存
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 我的 API Token ---------------- */

function TokenCard({ onMinted }: { onMinted: (token: string) => void }) {
  const tokens = useApi<{ tokens: TokenRow[] }>('/v1/tokens');
  const action = useAction();
  const [creating, setCreating] = useState(false);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserOutlined className="text-slate-400" aria-hidden />
        <h2 className="font-semibold text-slate-800">我的 API Token</h2>
        <span className="text-xs text-slate-400">
          给脚本或 MCP 客户端用的个人密钥（明文只显示一次）
        </span>
        <button
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          <PlusOutlined aria-hidden />
          新建 token
        </button>
      </div>
      {action.error && <ErrorText>{action.error}</ErrorText>}
      {action.message && <SuccessText>{action.message}</SuccessText>}
      {tokens.data?.tokens.length === 0 && (
        <p className="text-xs text-slate-400">
          还没有 token——新建一个即可在 REST/MCP 里以你本人的身份操作
        </p>
      )}
      <div className="space-y-2">
        {tokens.data?.tokens.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"
          >
            <span className="font-medium text-slate-700">{t.name}</span>
            <span className="font-mono text-xs text-slate-400">{t.prefix}…</span>
            <span className="flex gap-1">
              {t.scopes.map((s) => (
                <span
                  key={s}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500"
                >
                  {s}
                </span>
              ))}
            </span>
            <span className="ml-auto text-xs text-slate-400">
              {t.lastUsedAt ? `最近使用 ${timeAgo(t.lastUsedAt)}` : '从未使用'}
            </span>
            <button
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
              onClick={async () => {
                const ok = await action.run(
                  () => api.del(`/v1/tokens/${t.id}`),
                  `已吊销 ${t.name}`,
                );
                if (ok !== undefined) tokens.reload();
              }}
            >
              <DeleteOutlined aria-hidden />
              吊销
            </button>
          </div>
        ))}
      </div>

      {creating && (
        <CreateTokenModal
          onClose={() => setCreating(false)}
          onMinted={(token) => {
            setCreating(false);
            tokens.reload();
            onMinted(token);
          }}
        />
      )}
    </Card>
  );
}

function CreateTokenModal({
  onClose,
  onMinted,
}: {
  onClose: () => void;
  onMinted: (token: string) => void;
}) {
  const create = useAction();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read', 'write', 'mcp']);
  const toggle = (s: string) =>
    setScopes((arr) => (arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s]));

  return (
    <Modal title="新建 API Token" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="用途备注（如 我的脚本 / ZCode MCP）"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-3 text-sm text-slate-600">
          {(['read', 'write', 'mcp', 'admin'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
        {create.error && <ErrorText>{create.error}</ErrorText>}
        <button
          disabled={!name.trim() || scopes.length === 0 || create.running}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          onClick={async () => {
            const r = await create.run(() =>
              api.post<{ token: string }>('/v1/tokens', { name, scopes }),
            );
            if (r) onMinted(r.token);
          }}
        >
          创建
        </button>
      </div>
    </Modal>
  );
}
