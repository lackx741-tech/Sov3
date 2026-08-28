import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});