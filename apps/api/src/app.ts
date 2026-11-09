import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@agentpm/db';
import { getPrisma } from '@agentpm/db';
import { loadConfig, type AppConfig } from './config.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerAuth } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerActorRoutes } from './routes/actors.routes.js';
import { registerProjectRoutes } from './routes/projects.routes.js';
import { registerIssueRoutes } from './routes/issues.routes.js';
import { registerMcpRoute } from './routes/mcp.routes.js';
import { registerEventRoutes } from './routes/events.routes.js';
import { registerNotificationRoutes } from './routes/notifications.routes.js';
import { registerWebhookRoutes } from './routes/webhooks.routes.js';
import { registerReportRoutes } from './routes/reports.routes.js';
import { registerAvatarRoutes } from './routes/avatar.routes.js';
import type { FastifyApp } from './types.js';

export interface BuildAppOptions {
  /** 覆盖配置（测试用） */
  config?: Partial<AppConfig>;
  /** 外部传入 PrismaClient（测试用；默认读 DATABASE_URL 单例） */
  prisma?: PrismaClient;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyApp> {
  const cfg = { ...loadConfig(), ...opts.config };
  const ownsPrisma = !opts.prisma;
  const db = opts.prisma ?? getPrisma(cfg.DATABASE_URL);

  const app = Fastify({
    logger: { level: cfg.LOG_LEVEL },
    bodyLimit: 2 * 1024 * 1024,
  }) as FastifyApp;

  app.decorate('db', db);
  app.decorate('config', {
    mcpRateLimitPerMin: cfg.MCP_RATE_LIMIT_PER_MIN,
    fulltextEnabled: cfg.FULLTEXT_ENABLED,
  });

  await app.register(cookie);
  await app.register(jwt, { secret: cfg.JWT_SECRET });

  if (cfg.CORS_ORIGINS) {
    const origins = cfg.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await app.register(cors, {
      origin: origins[0] === '*' ? true : origins,
      credentials: true,
    });
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AgentPM API',
        description:
          'AI 原生项目管理系统。REST 与 MCP（/v1/mcp）共享同一套领域服务与审计。token 认证：`Authorization: Bearer apm_xxx`。',
        version: '0.1.0',
      },
      tags: [
        { name: 'auth', description: '注册 / 登录 / 会话' },
        { name: 'tokens', description: 'API token 管理' },
        { name: 'agents', description: 'agent 注册 / 心跳' },
        { name: 'projects', description: '项目 / 成员 / 统计 / 活动流 / sprint' },
        { name: 'issues', description: 'issue 全生命周期 / 领取 / 评论 / 进度 / 回归' },
        { name: 'mcp', description: 'MCP Streamable HTTP 端点（JSON-RPC）' },
      ],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'API token（apm_ 前缀）' },
          cookie: { type: 'apiKey', in: 'cookie', name: 'agentpm_session' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerErrorHandler(app);
  registerAuth(app);

  registerAuthRoutes(app);
  registerActorRoutes(app);
  registerProjectRoutes(app);
  registerIssueRoutes(app);
  registerEventRoutes(app);
  registerNotificationRoutes(app);
  registerWebhookRoutes(app);
  registerReportRoutes(app);
  registerAvatarRoutes(app);
  registerMcpRoute(app);

  app.get('/healthz', async () => ({ ok: true, service: 'agentpm-api' }));

  app.addHook('onClose', async () => {
    if (ownsPrisma) await db.$disconnect();
  });

  return app;
}
