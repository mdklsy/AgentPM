import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // 共享测试库：文件间不并行
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
  },
});
