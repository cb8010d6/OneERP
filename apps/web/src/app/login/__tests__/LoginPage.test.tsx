/**
 * LoginPage.tsx — 冒烟测试
 *
 * 覆盖:
 *  1. 渲染：标题、默认账号密码、提交按钮
 *  2. 输入：修改邮箱和密码
 *  3. 登录成功：调用 API → setAuth → router.push
 *  4. 登录失败：显示错误信息
 *  5. 加载态：按钮显示"正在接入核心..."
 */

/* ---------- Mock next/navigation ---------- */
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

/* ---------- Mock API ---------- */
const mockApiPost = jest.fn();
jest.mock('../../../lib/api', () => ({
  __esModule: true,
  default: { post: (...a: any[]) => mockApiPost(...a) },
}));

/* ---------- Mock authStore ---------- */
const mockSetAuth = jest.fn();
jest.mock('../../../store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: any) => selector({ setAuth: mockSetAuth }),
    { getState: jest.fn() },
  ),
}));

/* ---------- Tests ---------- */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../page';

describe('LoginPage 冒烟测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiPost.mockResolvedValue({
      data: {
        accessToken: 'jwt-token-abc',
        user: { id: 'u1', username: 'admin', role: 'admin' },
        companies: [{ id: 'c1', name: 'TestCo', role: 'owner' }],
      },
    });
  });

  it('渲染登录页标题', () => {
    render(<LoginPage />);
    expect(screen.getByText('智能制造 EIP 全局系统')).toBeInTheDocument();
  });

  it('默认填充 admin 账号和密码', () => {
    render(<LoginPage />);
    const emailInput = screen.getByPlaceholderText('请输入账号') as HTMLInputElement;
    const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    expect(emailInput.value).toBe('admin@erp.com');
    expect(passwordInput.value).toBe('admin');
  });

  it('提交按钮初始文案为"安全登入"', () => {
    render(<LoginPage />);
    expect(screen.getByText('安全登入')).toBeInTheDocument();
  });

  it('可以修改邮箱和密码', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    const emailInput = screen.getByPlaceholderText('请输入账号');
    const passwordInput = screen.getByPlaceholderText('••••••••');

    await user.clear(emailInput);
    await user.type(emailInput, 'test@example.com');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'mypassword');

    expect(emailInput).toHaveValue('test@example.com');
    expect(passwordInput).toHaveValue('mypassword');
  });

  it('登录成功后调用 API、setAuth 并跳转 /dashboard', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByText('安全登入'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/auth/login', {
        email: 'admin@erp.com',
        password: 'admin',
      });
    });

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalledWith(
        'jwt-token-abc',
        { id: 'u1', username: 'admin', role: 'admin' },
        [{ id: 'c1', name: 'TestCo', role: 'owner' }],
      );
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('登录失败显示错误信息', async () => {
    mockApiPost.mockRejectedValueOnce({
      response: { data: { message: '用户名或密码错误' } },
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByText('安全登入'));

    await waitFor(() => {
      expect(screen.getByText('用户名或密码错误')).toBeInTheDocument();
    });
  });

  it('无服务端 message 时显示默认错误文案', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Network Error'));

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByText('安全登入'));

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误，或系统未启动')).toBeInTheDocument();
    });
  });

  it('加载中按钮显示"正在接入核心..."', async () => {
    // 让 API 永远不 resolve 来模拟 loading
    mockApiPost.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByText('安全登入'));

    await waitFor(() => {
      expect(screen.getByText('正在接入核心...')).toBeInTheDocument();
    });
  });
});
