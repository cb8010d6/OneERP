import { defineConfig } from '@playwright/test';

/**
 * OneERP E2E 测试配置
 *
 * 运行前提:
 *   1. PostgreSQL 已启动，DATABASE_URL 已配置
 *   2. npx prisma migrate deploy 已执行
 *   3. API 服务已启动 (默认 http://localhost:8000)
 *
 * 运行方式:
 *   npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // ERP 业务链路有先后依赖，串行执行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000/api',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'e2e-api',
      testMatch: /.*\.spec\.ts$/,
    },
  ],
});
