import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage, {
  resolveDefaultLoginEmail,
  shouldShowQuickstartLoginHint,
} from '../page';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  readApiError: (_reason: unknown, fallback: string) => fallback,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('does not prefill the local administrator email in production', () => {
    expect(resolveDefaultLoginEmail(undefined, 'production')).toBe('');
    expect(resolveDefaultLoginEmail(undefined, 'development')).toBe(
      'admin@oneerp.local',
    );
    expect(
      resolveDefaultLoginEmail('uat-admin@example.com', 'production'),
    ).toBe('uat-admin@example.com');
    expect(shouldShowQuickstartLoginHint('production')).toBe(false);
    expect(shouldShowQuickstartLoginHint('development')).toBe(true);
  });

  it('lets the user reveal and hide the password without changing it', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const password = screen.getByLabelText('安全密码');
    await user.type(password, 'temporary-password');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('temporary-password');

    await user.click(screen.getByRole('button', { name: '隐藏密码' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('temporary-password');
  });
});
