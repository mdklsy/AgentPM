/**
 * prisma migrate dev 包装：
 * - 自动加载仓库根 .env；
 * - 剥离多余的 `--` 透传分隔符；
 * - Prisma 6 会自动创建 shadow 数据库（需要账号具备对应库的 CREATE/DROP 权限；
 *   本仓库的开发账号已获 `agentpm\_%` 与 `_prisma\_%` 授权）。
 * 用法：pnpm --filter @agentpm/db migrate -- --name init
 */
import { spawnSync } from 'node:child_process';
import { loadEnv } from '@agentpm/shared/node';

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (check .env at repo root)');
  process.exit(1);
}

const passthrough = process.argv.slice(2).filter((a, i) => !(a === '--' && i === 0));
const cmd = `prisma migrate dev ${passthrough.join(' ')}`.trim();
console.log(`[agentpm] > ${cmd}`);

const result = spawnSync(cmd, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
