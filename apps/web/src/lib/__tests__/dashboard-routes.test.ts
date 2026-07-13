import { resolveDashboardRoute } from '../dashboard-routes';

const routes = [
  { href: '/dashboard', label: '概览' },
  { href: '/dashboard/sales', label: '销售打单' },
  { href: '/dashboard/sales/requirements', label: '客户需求' },
];

describe('resolveDashboardRoute', () => {
  it('uses the most specific route for nested workspaces', () => {
    expect(
      resolveDashboardRoute('/dashboard/sales/requirements', routes)?.label,
    ).toBe('客户需求');
  });

  it('falls back to the nearest parent route for detail pages', () => {
    expect(resolveDashboardRoute('/dashboard/sales/orders/1', routes)?.label).toBe(
      '销售打单',
    );
  });

  it('returns undefined outside the dashboard route tree', () => {
    expect(resolveDashboardRoute('/login', routes)).toBeUndefined();
  });
});
