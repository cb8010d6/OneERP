import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  globalTimeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm --prefix ../apps/web run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
