import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAction, useApi } from '../api/hooks.js';
import {
  Card,
  EmptyState,
  ErrorText,
  Modal,
  Spinner,
  SuccessText,
  timeAgo,
} from '../components/ui.js';
import type { ProjectPageCtx } from './ProjectLayout.js';

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  secretMasked: string;
  lastDelivery: { ok: boolean; statusCode: number | null; createdAt: string } | null;
  createdAt: string;
}

interface DeliveryItem {
  id: string;
  event: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

/** Webhook 设置：订阅项目事件 → HMAC 签名 POST 到外部 URL；含投递日志与连通性测试。 */
export function WebhooksPage() {
  const { projectKey } = useOutletContext<ProjectPageCtx>();
  const { data, loading, error, reload } = useApi<{ webhooks: WebhookItem[] }>(
    `/v1/projects/${projectKey}/webhooks`,
  );
  const eventsApi = useApi<{ events: string[] }>('/v1/webhook-events');
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<WebhookItem | null>(null);
  const [pingMsg, setPingMsg] = useState<string | null>(null);
  const action = useAction();
  const [form, setForm] = useState({ url: '', events: ['*'] as string[] });

  const toggleEvent = (e: string) =>
    setForm((f) => {
      if (e === '*') return { ...f, events: ['*'] };
      const has = f.events.includes(e);
      let next = has ? f.events.filter((x) => x !== e) : [...f.events.filter((x) => x !== '*'), e];
      if (next.length === 0) next = ['*'];
      return { ...f, events: next };
    });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-700">Webhooks（出站事件推送）</h2>
          <p className="text-xs text-slate-400">
            项目事件以 HMAC-SHA256 签名 POST 到你的 URL（请求头
            x-agentpm-signature），密钥仅创建时显示
          </p>
        </div>
        <button
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={() => setCreating(true)}
        >
          + 新 Webhook
        </button>
      </div>
      {action.error && (
        <div className="mb-2">
          <ErrorText>{action.error}</ErrorText>
        </div>
      )}
      {(pingMsg ?? action.message) && (
        <div className="mb-2">
          <SuccessText>{pingMsg ?? action.message}</SuccessText>
        </div>
      )}

      {loading && <Spinner />}
      {error && <ErrorText>{error}</ErrorText>}
      {data && data.webhooks.length === 0 && (
        <EmptyState>还没有 webhook——把项目事件推到 CI、群机器人或你自己的服务</EmptyState>
      )}

      <div className="space-y-2">
        {data?.webhooks.map((h) => (
          <Card key={h.id} className="p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${h.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
                title={h.isActive ? '启用' : '停用'}
              />
              <span className="truncate font-mono text-xs text-slate-600">{h.url}</span>
              {h.lastDelivery && (
                <span
                  className={`rounded px-1.5 text-[11px] ${h.lastDelivery.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                >
                  最近投递 {h.lastDelivery.statusCode ?? 'ERR'} ·{' '}
                  {timeAgo(h.lastDelivery.createdAt)}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                  onClick={async () => {
                    setPingMsg(null);
                    const r = await action.run(() =>
                      api.post<{ ok: boolean; statusCode: number | null }>(
                        `/v1/projects/${projectKey}/webhooks/${h.id}/ping`,
                      ),
                    );
                    if (r) {
                      setPingMsg(
                        r.ok
                          ? `测试投递成功（HTTP ${r.statusCode}）`
                          : `测试投递失败（${r.statusCode ?? '网络错误'}）`,
                      );
                      reload();
                    }
                  }}
                >
                  测试
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  onClick={() => setLogOf(h)}
                >
                  投递日志
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  onClick={async () => {
                    await action.run(() =>
                      api.patch(`/v1/projects/${projectKey}/webhooks/${h.id}`, {
                        isActive: !h.isActive,
                      }),
                    );
                    reload();
                  }}
                >
                  {h.isActive ? '停用' : '启用'}
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                  onClick={async () => {
                    await action.run(
                      () => api.del(`/v1/projects/${projectKey}/webhooks/${h.id}`),
                      '已删除',
                    );
                    reload();
                  }}
                >
                  删除
                </button>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {h.events.map((e) => (
                <span
                  key={e}
                  className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600"
                >
                  {e}
                </span>
              ))}
              <span className="ml-auto text-[11px] text-slate-300">secret {h.secretMasked}</span>
            </div>
          </Card>
        ))}
      </div>

      {creating && (
        <Modal title="新建 Webhook" onClose={() => setCreating(false)} wide>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500">目标 URL（POST 接收方）</label>
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/hooks/agentpm"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">订阅事件</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {['*', ...(eventsApi.data?.events ?? [])].map((e) => (
                  <button
                    key={e}
                    onClick={() => toggleEvent(e)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      form.events.includes(e)
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            {action.error && <ErrorText>{action.error}</ErrorText>}
            <button
              disabled={!form.url.trim() || action.running}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={async () => {
                const r = await action.run(() =>
                  api.post<{ secret: string }>(`/v1/projects/${projectKey}/webhooks`, {
                    url: form.url,
                    events: form.events,
                  }),
                );
                if (r) {
                  setMinted(r.secret);
                  setCreating(false);
                  reload();
                }
              }}
            >
              创建（自动生成签名密钥）
            </button>
          </div>
        </Modal>
      )}

      {minted && (
        <Modal title="Webhook 签名密钥（仅此一次）" onClose={() => setMinted(null)} wide>
          <SuccessText>
            请立即保存，用于校验 x-agentpm-signature（HMAC-SHA256 of raw body）。
          </SuccessText>
          <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-300">
            {minted}
          </pre>
          <button
            className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() => void navigator.clipboard.writeText(minted).then(() => setMinted(null))}
          >
            复制并关闭
          </button>
        </Modal>
      )}

      {logOf && (
        <DeliveryLog projectKey={projectKey} webhook={logOf} onClose={() => setLogOf(null)} />
      )}
    </div>
  );
}

function DeliveryLog({
  projectKey,
  webhook,
  onClose,
}: {
  projectKey: string;
  webhook: WebhookItem;
  onClose: () => void;
}) {
  const { data, loading } = useApi<{ deliveries: DeliveryItem[] }>(
    `/v1/projects/${projectKey}/webhooks/${webhook.id}/deliveries`,
  );
  return (
    <Modal title={`投递日志 · ${webhook.url.slice(0, 40)}`} onClose={onClose} wide>
      {loading && <Spinner />}
      {data && data.deliveries.length === 0 && (
        <p className="text-xs text-slate-300">还没有投递记录</p>
      )}
      <div className="space-y-1.5">
        {data?.deliveries.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
          >
            <span
              className={`rounded px-1.5 text-[11px] font-bold ${d.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
            >
              {d.statusCode ?? 'ERR'}
            </span>
            <span className="font-mono text-xs text-slate-600">{d.event}</span>
            {d.error && <span className="truncate text-xs text-red-400">{d.error}</span>}
            <span className="ml-auto shrink-0 text-xs text-slate-400">
              {d.durationMs}ms · {timeAgo(d.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
