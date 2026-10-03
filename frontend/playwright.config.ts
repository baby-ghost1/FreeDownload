import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against `next dev` with every API call intercepted in-process
 * (see tests/e2e/api-mock.ts) — no backend or network required.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  timeout: 60_000,
  // Cold `next dev` compiles routes on first hit; keep a little headroom.
  expect: { timeout: 15_000 },
  workers: 2,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
