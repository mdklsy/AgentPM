import { z } from 'zod';
import { loadEnv } from '@agentpm/shared/node';

// 非必须场景下不强制 .env 存在（测试/CI 通过环境变量注入）
try {
  loadEnv();
} catch {
  /* ignore */
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16).default('agentpm-dev-secret-change-me-please'),
  CORS_ORIGINS: z.string().default(''),
  MCP_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  AGENT_MAX_CONCURRENT_CLAIMS: z.coerce.number().int().default(3),
  FULLTEXT_ENABLED: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
