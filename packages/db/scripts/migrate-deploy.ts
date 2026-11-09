/** prisma migrate deploy 包装：加载根 .env 后执行（生产/CI 用，无需 shadow 库）。 */
import { spawnSync } from 'node:child_process';
import { loadEnv } from '@agentpm/shared/node';

loadEnv();

const result = spawnSync('prisma migrate deploy', {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
