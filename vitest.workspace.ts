import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'packages/adapters/*/vitest.config.ts',
  'packages/output/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
]);
