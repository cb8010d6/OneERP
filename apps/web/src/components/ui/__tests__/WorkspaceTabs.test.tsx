import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceTabs } from '../WorkspaceTabs';
import { useWorkspaceTabsStore } from '@/store/workspaceTabsStore';
import { useI18nStore } from '@/lib/i18n';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => {
  mockPush.mockClear();
  useI18nStore.setState({ language: 'en-US' });
  useWorkspaceTabsStore.setState({
    tabs: [
      { id: 'home', path: '/dashboard', label: '概览' },
      { id: 'sales', path: '/dashboard/sales', label: 'Sales' },
      { id: 'purchase', path: '/dashboard/purchase', label: 'Purchase' },
    ],
    activePath: '/dashboard/sales',
  });
});

it('navigates to a surviving page when the active tab closes', () => {
  render(<WorkspaceTabs />);
  expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Close Sales' }));
  expect(useWorkspaceTabsStore.getState().activePath).toBe('/dashboard/purchase');
  expect(mockPush).toHaveBeenCalledWith('/dashboard/purchase');
  expect(screen.queryByRole('button', { name: 'Sales' })).not.toBeInTheDocument();
});

it('does not navigate away when an inactive tab closes', () => {
  render(<WorkspaceTabs />);
  fireEvent.click(screen.getByRole('button', { name: 'Close Purchase' }));
  expect(useWorkspaceTabsStore.getState().activePath).toBe('/dashboard/sales');
  expect(mockPush).not.toHaveBeenCalled();
});

it('returns to the localized home tab when the last business tab closes', () => {
  useWorkspaceTabsStore.setState({ tabs: useWorkspaceTabsStore.getState().tabs.slice(0, 2) });
  render(<WorkspaceTabs />);
  fireEvent.click(screen.getByRole('button', { name: 'Close Sales' }));
  expect(mockPush).toHaveBeenCalledWith('/dashboard');
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Close Overview' })).not.toBeInTheDocument();
});

it('activates and navigates to an existing tab', () => {
  render(<WorkspaceTabs />);
  fireEvent.click(screen.getByRole('button', { name: 'Purchase' }));
  expect(useWorkspaceTabsStore.getState().activePath).toBe('/dashboard/purchase');
  expect(mockPush).toHaveBeenCalledWith('/dashboard/purchase');
});
