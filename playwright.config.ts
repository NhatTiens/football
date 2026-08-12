import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run start -w @football-ai/api',
      url: 'http://127.0.0.1:4000/api/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        API_HOST: '127.0.0.1',
        API_PORT: '4000',
      },
    },
    {
      command: 'npm run start -w @football-ai/web',
      url: 'http://127.0.0.1:3000',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        INTERNAL_API_URL: 'http://127.0.0.1:4000/api',
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api',
      },
    },
  ],
});
