import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 测试需要直接引用 avatar-worker 源码（monorepo 跨包相对导入会被 vite 解析器拒绝）
      '#worker': resolve(__dirname, '../../apps/avatar-worker/src'),
    },
  },
  test: {
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // M6：文件并行但最多 2 个 fork（测试库共享，用例都用随机后缀世界隔离）
    fileParallelism: true,
    poolOptions: { forks: { maxForkThreads: 2 } },
    include: ['test/**/*.test.ts'],
  },
});
