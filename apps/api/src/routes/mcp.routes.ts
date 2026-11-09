import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type AppError } from '@agentpm/shared';
import { createAgentPmMcpServer } from '@agentpm/mcp-server';
import type { FastifyApp } from '../types.js';

/** 进程内每 token 令牌桶（多实例部署时替换为 Redis，见 roadmap M4） */
class TokenBuckets {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(private readonly perMinute: number) {}

  take(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, updatedAt: now };
    const refill = ((now - b.updatedAt) / 60_000) * this.perMinute;
    b.tokens = Math.min(this.perMinute, b.tokens + refill);
    b.updatedAt = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear(); // 粗暴防泄漏
    return true;
  }
}

/**
 * MCP Streamable HTTP 端点（ADR 0003）：
 * - 仅接受 Bearer apm_xxx 且具备 mcp scope 的 token；
 * - stateless：每请求新建 McpServer + transport（JSON 响应，无会话粘性）；
 * - 每 token 令牌桶限速。
 */
export function registerMcpRoute(app: FastifyApp) {
  const buckets = new TokenBuckets(app.config.mcpRateLimitPerMin);

  app.post('/v1/mcp', { bodyLimit: 8 * 1024 * 1024, config: { mcp: true } }, async (req, reply) => {
    /* ---- 认证：仅 Bearer token ---- */
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      reply.header('www-authenticate', 'Bearer');
      return reply.status(401).send(jsonRpcError(null, -32001, 'Missing Bearer token'));
    }
    if (req.actor === undefined) {
      // authenticateToken 已在 onRequest 尝试过；失败则 actor 未设置且错误被吞掉，这里再走一次拿准确错误
      const { authenticateToken } = await import('@agentpm/core');
      try {
        const { actor, token } = await authenticateToken(app.db, header.slice(7).trim());
        req.actor = actor;
        req.apiTokenId = token.id;
        req.scopes = (token.scopes as string[]) ?? [];
        req.authKind = 'API';
      } catch (e) {
        const err = e as AppError;
        return reply.status(err.statusCode ?? 401).send(jsonRpcError(null, -32001, err.message));
      }
    }
    if (!(req.scopes ?? []).includes('mcp')) {
      return reply.status(403).send(jsonRpcError(null, -32002, 'Token missing mcp scope'));
    }
    if (req.apiTokenId && !buckets.take(req.apiTokenId)) {
      reply.header('retry-after', '5');
      return reply.status(429).send(jsonRpcError(null, -32003, 'Rate limit exceeded'));
    }

    /* ---- stateless MCP ---- */
    const server = createAgentPmMcpServer({
      ctx: {
        db: app.db,
        actorId: req.actor!.id,
        actorType: req.actor!.type,
        actorName: req.actor!.name,
        apiTokenId: req.apiTokenId,
        source: 'MCP',
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? undefined,
      },
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    reply.hijack();
    // 注意：挂在响应对象上。请求对象(Node ≥16)在读完 body 时就发 close，会把 transport 提前关闭
    reply.raw.once('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // stateless JSON 模式不支持 GET (SSE) / DELETE (会话终止)
  app.get('/v1/mcp', async (_req, reply) => {
    reply.status(405).send(jsonRpcError(null, -32000, 'GET not supported (stateless JSON mode)'));
  });
  app.delete('/v1/mcp', async (_req, reply) => {
    reply
      .status(405)
      .send(jsonRpcError(null, -32000, 'DELETE not supported (stateless JSON mode)'));
  });
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
