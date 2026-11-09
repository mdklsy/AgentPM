import agentpm from '@agentpm/eslint-config';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.zcode/**'],
  },
  ...agentpm,
];
