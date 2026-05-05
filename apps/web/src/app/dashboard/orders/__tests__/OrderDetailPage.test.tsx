/**
 * OrderDetailPage.tsx — 冒烟测试
 *
 * 覆盖:
 *  1. 渲染：加载态 → 订单号、状态标签、基础信息
 *  2. Timeline：事件渲染、空态占位
 *  3. 产品明细：表格行渲染、金额汇总
 *  4. 关联卡片：工单 / 发票 空态
 *  5. 状态流转：按钮显示 → 点击提交
 *  6. 加载失败：跳转回列表
 */

/* ---------- Mock next/navigation ---------- */
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order-001' }),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

/* ---------- Mock API ---------- */
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('../../../../lib/api', () => ({
  __esModule: true,
  default: { get: (...a: any[]) => mockApiGet(...a), post: (...a: any[]) => mockApiPost(...a) },
}));

/* ---------- Mock authStore ---------- */
jest.mock('../../../../store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = { currentCompanyId: 'c1' };
      return typeof selector === 'function' ? selector(state) : state;
    },
    { getState: jest.fn() },
  ),
}));

/* ---------- Mock toast ---------- */
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: (...a: any[]) => mockToastError(...a), success: (...a: any[]) => mockToastSuccess(...a) },
}));

/* ---------- 测试数据 ---------- */
const mockOrder = {
  id: 'order-001',
  orderNo: 'SO-2025-0001',
  status: 'DRAFT',
  totalAmount: 50000,
  expectedDate: '2025-06-01T00:00:00Z',
  notes: '请优先安排生产',
  createdAt: '2025-01-15T08:00:00Z',
  partner: { id: 'p1', name: '测试客户A', contact: '张三', phone: '13800000000' },
  salesPerson: { id: 'sp1', name: '李销售' },
  items: [
    { id: 'item-1', productId: 'PROD-001', quantity: 10, unitPrice: 5000, totalPrice: 50000 },
  ],
  workOrders: [],
  invoices: [],
};

const mockTimelineEvents = {
  data: {
    events: [
      { id: 'ev1', action: 'CREATED', createdAt: '2025-01-15T08:00:00Z', user: { name: 'admin' } },
      { id: 'ev2', action: 'UPDATED', createdAt: '2025-01-16T10:30:00Z', user: { email: 'sales@test.com' } },
    ],
  },
};

/* ---------- Tests ---------- */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrderDetailPage from '../[id]/page';

describe('OrderDetailPage 冒烟测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: mockOrder });
      if (url === '/orders/order-001/timeline') return Promise.resolve(mockTimelineEvents);
      return Promise.resolve({ data: {} });
    });
    mockApiPost.mockResolvedValue({});
  });

  it('加载成功后显示订单号和状态标签', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByText((_, element) => element?.textContent === '订单 SO-2025-0001'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('显示基础信息：客户名称、销售负责人', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('测试客户A')).toBeInTheDocument();
    });
    expect(screen.getByText('李销售')).toBeInTheDocument();
  });

  it('显示产品明细表格和金额', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('PROD-001')).toBeInTheDocument();
    });
    expect(screen.getByText('¥50,000')).toBeInTheDocument();
  });

  it('Timeline 渲染事件', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('CREATED')).toBeInTheDocument();
    });
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('Timeline 为空时显示占位', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: mockOrder });
      if (url === '/orders/order-001/timeline') return Promise.resolve({ data: { events: [] } });
      return Promise.resolve({ data: {} });
    });
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('暂无动态记录。')).toBeInTheDocument();
    });
  });

  it('DRAFT 状态显示"提交订单"按钮', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('提交订单')).toBeInTheDocument();
    });
  });

  it('点击"提交订单"触发状态流转', async () => {
    const user = userEvent.setup();
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('提交订单')).toBeInTheDocument();
    });
    await user.click(screen.getByText('提交订单'));
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/v1/workflow/order/order-001/transition',
        { action: 'submit' },
      );
    });
  });

  it('关联工单和发票为空时显示占位', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('暂无工单记录')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无发票记录')).toBeInTheDocument();
  });

  it('加载失败后跳转回订单列表', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.reject(new Error('Not found'));
      return Promise.resolve({ data: { events: [] } });
    });
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('加载订单详情失败');
      expect(mockPush).toHaveBeenCalledWith('/dashboard/orders');
    });
  });

  it('PENDING 状态显示"开始生产"按钮', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: { ...mockOrder, status: 'PENDING' } });
      return Promise.resolve({ data: { events: [] } });
    });
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('开始生产')).toBeInTheDocument();
    });
  });

  it('COMPLETED 状态不显示流转按钮', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: { ...mockOrder, status: 'COMPLETED' } });
      return Promise.resolve({ data: { events: [] } });
    });
    render(<OrderDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('已完成')).toBeInTheDocument();
    });
    expect(screen.queryByText('提交订单')).not.toBeInTheDocument();
    expect(screen.queryByText('取消订单')).not.toBeInTheDocument();
  });
});
