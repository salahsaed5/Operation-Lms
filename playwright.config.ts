import { defineConfig, devices } from '@playwright/test';

const remote = Boolean(process.env.BASE_URL);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: remote ? undefined : {
    command: 'bun run preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
