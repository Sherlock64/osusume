import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // Resolve @osusume/shared to its source so tests need no prior build.
      conditions: ['@osusume/source', 'node'],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Database tests create their own scratch databases.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
