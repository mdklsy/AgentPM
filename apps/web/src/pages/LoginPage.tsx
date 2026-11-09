import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';
import { ErrorText } from '../components/ui.js';

export function LoginPage() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await api.post('/v1/auth/login', { username, password });
      } else {
        await api.post('/v1/auth/register', { username, password });
        await api.post('/v1/auth/login', { username, password });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-lg">
            ⬢
          </div>
          <h1 className="text-2xl font-bold text-slate-800">AgentPM</h1>
          <p className="mt-1 text-sm text-slate-500">人类与 AI Agent 在同一个项目里协作</p>
        </div>
        <form
          onSubmit={submit}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-1 flex rounded-lg bg-slate-100 p-1 text-sm">
            <button
              type="button"
              className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'login' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
              onClick={() => setMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'register' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
              onClick={() => setMode('register')}
            >
              注册
            </button>
          </div>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名（小写字母/数字/中划线）"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? '密码（至少 8 位）' : '密码'}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          {error && <ErrorText>{error}</ErrorText>}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
          {mode === 'register' && (
            <p className="text-center text-xs text-slate-400">第一个注册的用户自动成为实例管理员</p>
          )}
        </form>
      </div>
    </div>
  );
}
