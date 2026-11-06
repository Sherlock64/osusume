import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // The tests build on each other, in file order, against one deployment.
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  outputDir: '.results',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
});
