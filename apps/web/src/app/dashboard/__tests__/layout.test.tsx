import React, { useState } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import DashboardLayout from '../layout';
import { useAuthStore } from '@/store/authStore';

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

it('clears business and command drafts when company changes', () => {
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
