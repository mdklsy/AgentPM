import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint 9 flat config for the AgentPM monorepo.
 * Usage (eslint.config.js at repo root or per package):
 *   import agentpm from '@agentpm/eslint-config';
 *   export default [...agentpm];
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/src/generated/**',
      '**/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // Allow console & process.exit in executable entrypoints
    files: ['**/scripts/**/*.ts', '**/bin/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests: relax a bit
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
