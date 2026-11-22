import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a full local stack (web + API + seeded DB + MinIO).
 *   pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm dev   # in one terminal
 *   pnpm --filter @railguard/web e2e                               # in another
 * In CI the workflow starts the stack itself (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
  ],
});
