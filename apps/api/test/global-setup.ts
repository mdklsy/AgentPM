/**
 * 全局测试准备（vitest globalSetup，独立进程）：
 * 1. 确保 agentpm_test 存在（ROOT_DATABASE_URL 或同账号自建）；
 * 2. prisma db push 同步 schema；
 * 3. 清空全部表。
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrisma } from '@agentpm/db';
import { loadEnv } from '@agentpm/shared/node';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

export async function setup(): Promise<void> {
  loadEnv();
  const testUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/[^/?]+/, '/agentpm_test');
  if (!testUrl) throw new Error('TEST_DATABASE_URL / DATABASE_URL missing');
  process.env.DATABASE_URL = testUrl; // 供后续 worker 继承（vitest 会透传 mutation? 不会——setup-env 再做一次）

  // 1. 建库（若同账号无建库权限，则假定库已存在）
  try {
    const bootUrl =
      process.env.ROOT_DATABASE_URL ?? testUrl.replace(/\/[^/?]+(\?.*)?$/, '/mysql$1');
    const boot = createPrisma(bootUrl);
    await boot.$executeRawUnsafe(
      'CREATE DATABASE IF NOT EXISTS `agentpm_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
    );
    await boot.$disconnect();
  } catch (e) {
    console.warn('[global-setup] 无法自建测试库（可能已存在）:', (e as Error).message);
  }

  // 2. 同步 schema（db push，不走迁移，秒级）
  const dbPkg = join(repoRoot, 'packages', 'db');
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: dbPkg,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
    shell: true,
  });

  // 3. 清空
  const db = createPrisma(testUrl);
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  const tables = (await db.$queryRawUnsafe('SHOW TABLES')) as Array<{ [k: string]: string }>;
  for (const row of tables) {
    const table = Object.values(row)[0];
    if (table) await db.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
  }
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

  // 4. 预置实例管理员（首用户即 admin 的规则在并行测试里不可依赖）
  const { hash } = await import('@node-rs/argon2');
  await db.actor.upsert({
    where: { name: 'admin' },
    create: {
      type: 'HUMAN',
      name: 'admin',
      displayName: 'Admin',
      passwordHash: await hash('admin-test-pass-123'),
      isAdmin: true,
    },
    update: {},
  });
  await db.$disconnect();
  console.info(`[global-setup] test db ready (${testUrl.replace(/\/\/.*@/, '//***@')})`);
}
