import { act, cleanup, render, screen } from '@testing-library/react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import DashboardClient from '@/app/dashboard/DashboardClient';
import { OperatorGuide } from '../OperatorGuide';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('@/components/ai/Chat2DashPanel', () => ({
  Chat2DashPanel: () => null,
}));

const mockedApi = api as jest.Mocked<typeof api>;

function setCompanies(
  companies: Array<{
    id: string;
    name: string;
    role: string;
    permissions: string[];
  }>,
  currentCompanyId: string,
) {
  useAuthStore.setState({ companies, currentCompanyId });
}

describe('OperatorGuide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ token: null, user: null });
    setCompanies(
      [
        {
          id: 'company-a',
          name: 'Company A',
          role: 'Owner',
          permissions: ['ALL'],
        },
      ],
      'company-a',
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('links only to the supported company setup routes', () => {
    render(<OperatorGuide />);

    expect(screen.getByRole('link', { name: '创建客户与供应商' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/partner',
    );
    expect(screen.getByRole('link', { name: '新建物料' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/material',
    );
    expect(screen.getByRole('link', { name: '新建库位' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/stockLocation',
    );
    expect(screen.getByRole('link', { name: '新建产品' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/product',
    );
    expect(screen.getByRole('link', { name: '创建采购单' })).toHaveAttribute(
      'href',
      '/dashboard/purchase',
    );
    expect(screen.getByRole('link', { name: '创建销售订单' })).toHaveAttribute(
      'href',
      '/dashboard/sales',
    );
    expect(screen.getByRole('link', { name: '打开财务管理' })).toHaveAttribute(
      'href',
      '/dashboard/finance',
    );
    expect(screen.getByRole('link', { name: '查看税码' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/taxCode',
    );
  });

  it('shows view actions for read-only users and withholds links without read access', () => {
    setCompanies(
      [
        {
          id: 'company-a',
          name: 'Company A',
          role: 'Viewer',
          permissions: [
            'partner:read',
            'material:read',
            'product:create',
            'purchase:read',
            'order:read',
            'finance:read',
            'taxCode:create',
          ],
        },
      ],
      'company-a',
    );

    render(<OperatorGuide />);

    expect(
      screen.getByRole('link', { name: '查看客户与供应商' }),
    ).toHaveAttribute('href', '/dashboard/dynamic/partner');
    expect(screen.getByRole('link', { name: '查看物料' })).toHaveAttribute(
      'href',
      '/dashboard/dynamic/material',
    );
    expect(screen.getByRole('link', { name: '查看采购管理' })).toHaveAttribute(
      'href',
      '/dashboard/purchase',
    );
    expect(screen.getByRole('link', { name: '查看销售订单' })).toHaveAttribute(
      'href',
      '/dashboard/sales',
    );
    expect(screen.queryByRole('link', { name: '新建产品' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看税码' })).not.toBeInTheDocument();
    expect(screen.getAllByText('请联系管理员开通读取权限')).toHaveLength(3);
  });

  it('honors permission wildcards and changes actions with the selected company', () => {
    setCompanies(
      [
        {
          id: 'company-a',
          name: 'Company A',
          role: 'Viewer',
          permissions: ['partner:read', 'partner:*', 'material:read', '*:create'],
        },
        {
          id: 'company-b',
          name: 'Company B',
          role: 'Owner',
          permissions: ['ALL'],
        },
      ],
      'company-a',
    );

    render(<OperatorGuide />);
    expect(
      screen.getByRole('link', { name: '创建客户与供应商' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '新建物料' })).toBeInTheDocument();

    act(() => useAuthStore.getState().setCurrentCompany('company-b'));
    expect(screen.getByRole('link', { name: '新建物料' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建销售订单' })).toBeInTheDocument();
  });

  it('has no completion checkboxes, percentages, or stored status claims', () => {
    render(<OperatorGuide />);

    const guide = screen.getByRole('region', { name: '采购与销售开工指南' });
    expect(guide.querySelector('input[type="checkbox"]')).not.toBeInTheDocument();
    expect(guide.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
    expect(guide.textContent).not.toContain('%');
    expect(guide.textContent).not.toContain('已完成');
  });

  it('remains visible when dashboard statistics fail to load', async () => {
    mockedApi.get.mockRejectedValue(new Error('statistics unavailable'));
    useAuthStore.setState({ token: 'test-token' });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<DashboardClient />);

    expect(await screen.findByText('statistics unavailable')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: '采购与销售开工指南' }),
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
