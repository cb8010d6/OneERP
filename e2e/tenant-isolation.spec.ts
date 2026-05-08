import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginUser,
  authHeaders,
  type AuthResult,
} from './helpers';

test.describe('租户越权访问失败', () => {
  let adminAuth: AuthResult;
  let otherAuth: AuthResult;
  let adminCompanyId: string;

  test.beforeAll(async ({ request }) => {
    // admin 拥有多公司
    adminAuth = await loginUser(request, 'admin@erp.com', 'admin');
    adminCompanyId = adminAuth.companies[0].id;

    // 注册一个新用户 (无公司关联)
    const email = `e2e_other_${Date.now()}@test.com`;
    otherAuth = await registerUser(request, email, 'test12345', '越权测试员');
  });

  test('6.1 新用户无公司 → 缺少 x-company-id 返回 403', async ({
    request,
  }) => {
    const headers = {
      Authorization: `Bearer ${otherAuth.accessToken}`,
      'x-company-id': adminCompanyId, // 尝试访问 admin 的公司
    };
    const res = await request.get('/orders', { headers });
    // 应被 TenantGuard 拦截: 403
    expect(res.status()).toBe(403);
  });

  test('6.2 新用户伪造 x-company-id → 返回 403', async ({ request }) => {
    const fakeCompanyId = '00000000-0000-0000-0000-000000000000';
    const headers = {
      Authorization: `Bearer ${otherAuth.accessToken}`,
      'x-company-id': fakeCompanyId,
    };
    const res = await request.get('/orders', { headers });
    expect(res.status()).toBe(403);
  });

  test('6.3 无 Token + 伪造 x-company-id → 返回 401', async ({
    request,
  }) => {
    const headers = {
      'x-company-id': adminCompanyId,
    };
    const res = await request.get('/orders', { headers });
    expect([401, 403]).toContain(res.status());
  });

  test('6.4 admin 用合法公司访问 → 返回 200', async ({ request }) => {
    const headers = authHeaders(adminAuth);
    const res = await request.get('/orders', { headers });
    expect(res.ok()).toBeTruthy();
  });

  test('6.5 admin 尝试访问不存在的公司 → 返回 403', async ({ request }) => {
    const headers = {
      Authorization: `Bearer ${adminAuth.accessToken}`,
      'x-company-id': 'non-existent-company-id',
    };
    const res = await request.get('/orders', { headers });
    expect(res.status()).toBe(403);
  });

  test('6.6 越权创建伙伴 → 被 TenantGuard 拦截', async ({ request }) => {
    const headers = {
      Authorization: `Bearer ${otherAuth.accessToken}`,
      'x-company-id': adminCompanyId,
    };
    const res = await request.post('/v1/resource/Partner', {
      data: { name: '越权伙伴', code: 'HACK-001', type: 'CUSTOMER' },
      headers,
    });
    expect(res.status()).toBe(403);
  });

  test('6.7 越权访问财务发票 → 被 TenantGuard 拦截', async ({ request }) => {
    const headers = {
      Authorization: `Bearer ${otherAuth.accessToken}`,
      'x-company-id': adminCompanyId,
    };
    const res = await request.get('/finance/invoices', { headers });
    expect(res.status()).toBe(403);
  });
});
