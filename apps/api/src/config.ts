import { fileURLToPath } from 'node:url';
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
  /** 附件落盘目录（M6）；默认仓库根 data/uploads */
  ATTACHMENTS_DIR: z
    .string()
    .default(fileURLToPath(new URL('../../../../data/uploads', import.meta.url))),
  /** 邮件通知（M6）：SMTP_HOST 缺省 = 邮件关闭 */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** 出现在邮件/通知链接里的对外地址 */
  APP_URL: z.string().default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
