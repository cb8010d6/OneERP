import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginUser,
  authHeaders,
  type AuthResult,
} from './helpers';

test.describe('认证流程: 注册 / 登录 / 选择公司', () => {
  let auth: AuthResult;

  test('1.1 注册新用户 → 返回 accessToken 和 companies', async ({
    request,
  }) => {
    const email = `e2e_auth_${Date.now()}@test.com`;
    auth = await registerUser(request, email, 'test12345', 'E2E测试员');

    expect(auth.accessToken).toBeTruthy();
    expect(auth.user.email).toBe(email);
    expect(auth.user.name).toBe('E2E测试员');
    expect(auth.user.id).toBeTruthy();
    // 新注册用户没有公司关联
    expect(Array.isArray(auth.companies)).toBe(true);
  });

  test('1.2 登录已有种子用户 admin@erp.com → 返回 companies 列表', async ({
    request,
  }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');

    expect(auth.accessToken).toBeTruthy();
    expect(auth.user.email).toBe('admin@erp.com');
    expect(auth.companies.length).toBeGreaterThanOrEqual(1);
    expect(auth.companies[0].id).toBeTruthy();
    expect(auth.companies[0].name).toBeTruthy();
  });

  test('1.3 选择公司: 使用 x-company-id 访问受保护资源', async ({
    request,
  }) => {
    if (!auth) auth = await loginUser(request, 'admin@erp.com', 'admin');

    const headers = authHeaders(auth);
    const res = await request.get('/orders', { headers });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
  });

  test('1.4 登录失败: 错误密码返回 401', async ({ request }) => {
    const res = await request.post('/auth/login', {
      data: { email: 'admin@erp.com', password: 'wrong_password' },
    });
    expect(res.status()).toBe(401);
  });

  test('1.5 注册失败: 重复邮箱返回 409', async ({ request }) => {
    const res = await request.post('/auth/register', {
      data: {
        email: 'admin@erp.com',
        password: 'test12345',
        name: '重复用户',
      },
    });
    expect(res.status()).toBe(409);
  });

  test('1.6 登录返回 refreshToken 和 accessToken', async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    expect(auth.accessToken).toBeTruthy();
    // 登录现在也返回 refreshToken
    expect(auth.refreshToken).toBeTruthy();
    expect(auth.accessTokenExpiresIn).toBe(900);
  });

  test('1.7 refresh 端点使用 refreshToken 换取新 token', async ({ request }) => {
    const loginRes = await request.post('/auth/login', {
      data: { email: 'admin@erp.com', password: 'admin' },
    });
    const loginBody = await loginRes.json();
    const refreshToken = loginBody.refreshToken;
    expect(refreshToken).toBeTruthy();

    const refreshRes = await request.post('/auth/refresh', {
      data: { refreshToken },
    });
    expect(refreshRes.ok()).toBeTruthy();
    const refreshBody = await refreshRes.json();
    expect(refreshBody.accessToken).toBeTruthy();
    expect(refreshBody.refreshToken).toBeTruthy();
    expect(refreshBody.refreshToken).not.toBe(refreshToken); // rotation
  });

  test('1.8 旧 refreshToken 被轮换后不能再使用', async ({ request }) => {
    const loginRes = await request.post('/auth/login', {
      data: { email: 'admin@erp.com', password: 'admin' },
    });
    const loginBody = await loginRes.json();
    const oldRefreshToken = loginBody.refreshToken;

    // 第一次 refresh 成功
    await request.post('/auth/refresh', {
      data: { refreshToken: oldRefreshToken },
    });

    // 第二次用旧 token 应失败（reuse detection）
    const reuseRes = await request.post('/auth/refresh', {
      data: { refreshToken: oldRefreshToken },
    });
    expect(reuseRes.status()).toBe(401);
  });

  test('1.9 无 Token 访问受保护资源 → 401', async ({ request }) => {
    const res = await request.get('/orders');
    expect([401, 403]).toContain(res.status());
  });
});
