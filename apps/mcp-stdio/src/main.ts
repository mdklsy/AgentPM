#!/usr/bin/env node
/**
 * AgentPM stdio MCP 网关（ADR 0003）：
 * stdin 逐行读 JSON-RPC 消息 → 原样 POST 到远端 /v1/mcp → 响应写回 stdout。
 * 对未知方法透传（前向兼容）；支持 JSON 与 SSE 两种响应形态。
 *
 * 用法：
 *   agentpm-mcp --url http://127.0.0.1:3000/v1/mcp --token apm_xxx
 *   或环境变量 AGENTPM_MCP_URL / AGENTPM_MCP_TOKEN
 */
import { createInterface } from 'node:readline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const urlArg = arg('url') ?? process.env.AGENTPM_MCP_URL;
const tokenArg = arg('token') ?? process.env.AGENTPM_MCP_TOKEN;

if (!urlArg || !tokenArg) {
  process.stderr.write('usage: agentpm-mcp --url <http://host:port/v1/mcp> --token <apm_xxx>\n');
  process.exit(1);
}

// 闭包内保持收窄（const 快照）
const ENDPOINT: string = urlArg;
const TOKEN: string = tokenArg;

function writeJsonRpc(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function forward(message: string): Promise<void> {
  let parsed: { id?: string | number | null };
  try {
    parsed = JSON.parse(message);
  } catch {
    return; // 非 JSON 行（客户端噪声）直接忽略
  }
  const id = parsed.id ?? null;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
        'mcp-session-id': sessionHeader.get('mcp-session-id') ?? '',
      },
      body: message,
    });
  } catch (e) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: `gateway: ${(e as Error).message}` },
    });
    return;
  }

  // 会话头透传（stateless 模式通常为空；保留以便未来兼容有状态服务端）
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionHeader.set('mcp-session-id', sid);

  if (res.status === 202 || res.status === 204) return; // 通知类，无响应体

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    // 流式响应：解析 SSE data: 行，逐条写回
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop() ?? '';
      for (const evt of events) {
        for (const line of evt.split(/\r?\n/)) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data && data !== '[DONE]') {
              try {
                writeJsonRpc(JSON.parse(data));
              } catch {
                /* 忽略残缺事件 */
              }
            }
          }
        }
      }
    }
    return;
  }

  const text = await res.text();
  if (!text) return;
  try {
    const body = JSON.parse(text) as unknown;
    if (Array.isArray(body)) {
      for (const item of body) writeJsonRpc(item); // 批量响应
    } else {
      writeJsonRpc(body);
    }
  } catch {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: `gateway: 非 JSON 响应（HTTP ${res.status}）` },
    });
  }
}

const sessionHeader = new Map<string, string>();

process.stderr.write(`[agentpm-mcp] gateway → ${ENDPOINT}\n`);

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  void forward(trimmed);
});
rl.on('close', () => process.exit(0));
