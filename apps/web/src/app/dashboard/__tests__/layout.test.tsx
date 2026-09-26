import React, { useState } from 'react';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import DashboardLayout from '../layout';
import { useAuthStore } from '@/store/authStore';
import { useI18nStore } from '@/lib/i18n';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard/sales',
}));
jest.mock('@/components/ui/WorkspaceTabs', () => ({
  WorkspaceTabs: () => null,
}));
jest.mock('@/components/ai/CommandPalette', () => ({
  CommandPalette: function Palette() {
    const [value, setValue] = React.useState('');
    return (
      <input
        aria-label="command draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  },
}));

function BusinessForm() {
  const company = useAuthStore((state) => state.currentCompanyId);
  const [value, setValue] = useState('');
  return (
    <>
      <span>Records for {company}</span>
      <input
        aria-label="order draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useI18nStore.setState({ language: 'zh-CN' });
  const token = `${btoa('{}')}.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`;
  useAuthStore.setState({
    token,
    user: { id: 'u1' },
    currentCompanyId: 'c1',
    companies: [
      { id: 'c1', name: 'A', role: 'owner', permissions: ['ALL'] },
      { id: 'c2', name: 'B', role: 'owner', permissions: ['ALL'] },
    ],
    refreshPermissions: jest.fn().mockResolvedValue(undefined),
  });
});

it('clears business and command drafts when company changes', () => {
  render(
    <DashboardLayout>
      <BusinessForm />
    </DashboardLayout>,
  );
  fireEvent.change(screen.getByLabelText('order draft'), {
    target: { value: 'A order' },
  });
  fireEvent.change(screen.getByLabelText('command draft'), {
    target: { value: 'A search' },
  });
  act(() => useAuthStore.getState().setCurrentCompany('c2'));
  expect(screen.getByText('Records for c2')).toBeInTheDocument();
  expect(screen.queryByText('Records for c1')).not.toBeInTheDocument();
  expect(screen.getByLabelText('order draft')).toHaveValue('');
  expect(screen.getByLabelText('command draft')).toHaveValue('');
});

it('keeps optional tools collapsed and exposes a named toggle', () => {
  useI18nStore.setState({ language: 'en-US' });
  render(<DashboardLayout><div>Business content</div></DashboardLayout>);
  const toggle = screen.getByRole('button', { name: 'Toggle side panel' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Productivity Panel')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

it('contains keyboard focus in mobile navigation, closes on Escape and restores focus', () => {
  useI18nStore.setState({ language: 'en-US' });
  render(<DashboardLayout><div>Business content</div></DashboardLayout>);
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Primary navigation' });
  const close = within(dialog).getByRole('button', { name: 'Close navigation' });
  const last = within(dialog).getByRole('button', { name: 'Sign out' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(close).toHaveFocus();
  expect(screen.getByRole('main')).toHaveAttribute('inert');
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.getByRole('main')).not.toHaveAttribute('inert');
});

it('keeps navigation permission-filtered and marks the current route', () => {
  useAuthStore.setState({
    companies: [{ id: 'c1', name: 'A', role: 'staff', permissions: ['order:read'] }],
  });
  render(<DashboardLayout><div>Business content</div></DashboardLayout>);
  const navigation = screen.getByRole('navigation', { name: '主导航' });
  expect(within(navigation).getByRole('button', { name: '销售打单' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).queryByRole('button', { name: '财务管理' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '当前公司' })).toHaveValue('c1');
});

it.each(['overlay', 'navigation', 'desktop resize'])('closes mobile navigation on %s', (action) => {
  useI18nStore.setState({ language: 'en-US' });
  render(<DashboardLayout><div>Business content</div></DashboardLayout>);
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  if (action === 'overlay') {
    fireEvent.click(screen.getAllByRole('button', { name: 'Close navigation' }).find((button) => !dialog.contains(button))!);
  } else if (action === 'navigation') {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Purchase' }));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/purchase');
  } else {
    // jsdom's default viewport width is 1024, the existing lg breakpoint.
    fireEvent(window, new Event('resize'));
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
