import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e-sandbox',
  timeout:30_000,
  retries:process.env.CI?1:0,
  workers:1,
  use:{
    baseURL:'http://127.0.0.1:3000',
    ...devices['Desktop Chrome'],
    screenshot:'only-on-failure',
    trace:'off',
  },
  webServer:{
    command:'bun run dev --port=3000 --host 127.0.0.1',
    url:'http://127.0.0.1:3000',
    reuseExistingServer:!process.env.CI,
    timeout:120_000,
    env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:''},
  },
});
