/**
 * 每个 worker 的环境准备：在任何模块 import 之前，
 * 把 DATABASE_URL 切到测试库（TEST_DATABASE_URL）。
 */
import { loadEnv } from '@agentpm/shared/node';

loadEnv();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.JWT_SECRET ??= 'vitest-secret-0123456789abcdef';
process.env.LOG_LEVEL = 'error';
process.env.MCP_RATE_LIMIT_PER_MIN = '10000';
