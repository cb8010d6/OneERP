/**
 * Web 冒烟测试 — 核心前端功能可用性验证
 *
 * 覆盖:
 *  1. 登录页：渲染 + 默认值 + 提交 + 错误
 *  2. DynamicView：列表加载 / 新建 / 编辑 / 引用字段选择
 *  3. 订单详情 timeline：事件渲染 / 空态 / 批注提交
 *
 * 这是一个聚合层面的冒烟测试，验证各核心页面/组件的关键路径。
 */

/* ========================================================
   Mock 公共依赖
   ======================================================== */

/* localStorage */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((k: string) => store[k] ?? null),
    setItem: jest.fn((k: string, v: string) => { store[k] = v; }),
    removeItem: jest.fn((k: string) => { delete store[k]; }),
    clear: jest.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });
Object.defineProperty(global, 'window', {
  value: {
    location: { href: '' },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  writable: true,
});

/* next/navigation */
const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
  useParams: () => ({ id: 'order-001' }),
}));

/* Dynamic resource mocks */
const mockFetchSchema = jest.fn();
const mockFetchResourceList = jest.fn();
const mockCreateResource = jest.fn();
const mockUpdateResource = jest.fn();
jest.mock('@/lib/dynamic-resource', () => ({
  fetchSchema: (...a: any[]) => mockFetchSchema(...a),
  fetchResourceList: (...a: any[]) => mockFetchResourceList(...a),
  createResource: (...a: any[]) => mockCreateResource(...a),
  updateResource: (...a: any[]) => mockUpdateResource(...a),
}));

/* API mock */
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('@/lib/api', () => ({
  default: { get: (...a: any[]) => mockApiGet(...a), post: (...a: any[]) => mockApiPost(...a) },
}));

/* Child component mocks for DynamicView */
jest.mock('@/components/core/ListEngine', () => ({
  ListEngine: ({ onRowClick, onSearchChange }: any) => (
    <div data-testid="list-engine">
      <button data-testid="row-click" onClick={() => onRowClick?.({ id: 'row-1', name: 'Test Row' })}>row</button>
      <input data-testid="search-input" onChange={(e: any) => onSearchChange?.(e.target.value)} />
    </div>
  ),
}));
jest.mock('@/components/core/KanbanEngine', () => ({
  KanbanEngine: () => <div data-testid="kanban-engine" />,
}));
jest.mock('@/components/core/FormEngine', () => ({
  FormEngine: ({ value, onChange, onSubmit }: any) => (
    <div data-testid="form-engine">
      <input data-testid="form-name" value={String(value?.name ?? '')} onChange={(e: any) => onChange?.({ ...value, name: e.target.value })} />
      <button data-testid="form-submit" onClick={() => onSubmit?.()}>submit</button>
    </div>
  ),
}));
jest.mock('@/components/ui/Sheet', () => ({
  Sheet: ({ open, children, onClose, title }: any) =>
    open ? (
      <div data-testid="sheet">
        <span data-testid="sheet-title">{title}</span>
        <button data-testid="sheet-close" onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
}));

/* ========================================================
   测试数据
   ======================================================== */

import type { UiSchema } from '@/lib/ui-schema';

const mockSchema: UiSchema = {
  model: 'Product', label: '产品', description: '产品管理',
  fields: [
    { name: 'id', label: 'ID', type: 'string' },
    { name: 'name', label: '名称', type: 'string', required: true },
    { name: 'status', label: '状态', type: 'select', options: [{ label: '草稿', value: 'Draft' }, { label: '已发布', value: 'Published' }] },
    { name: 'categoryId', label: '分类', type: 'reference', reference: { model: 'Category', labelField: 'name', valueField: 'id', relationField: 'category' } },
  ],
  views: {
    form: { fields: ['name', 'status', 'categoryId'] },
    list: { columns: ['id', 'name', 'status', 'categoryId'], searchFields: ['name'] },
  },
};

const mockListResponse = {
  data: [{ id: '1', name: '产品A', status: 'Published' }, { id: '2', name: '产品B', status: 'Draft' }],
  total: 2, page: 1, limit: 20, totalPages: 1,
};

const mockRefOptions = {
  data: [{ id: 'cat-1', name: '电子元器件' }, { id: 'cat-2', name: '机械零件' }],
  total: 2, page: 1, limit: 200, totalPages: 1,
};

const mockTimelineEvents = {
  data: {
    events: [
      { id: 'ev1', action: 'CREATED', createdAt: '2025-01-01T00:00:00Z', user: { name: 'admin' } },
      { id: 'ev2', action: 'UPDATED', createdAt: '2025-01-02T00:00:00Z', user: { email: 'user@test.com' } },
    ],
  },
};

/* ========================================================
   Smoke 1: DynamicView 核心流程
   ======================================================== */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicView } from '@/components/core/DynamicView';

describe('Smoke · DynamicView 核心流程', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockFetchSchema.mockResolvedValue(mockSchema);
    mockFetchResourceList.mockResolvedValue(mockListResponse);
    mockApiGet.mockResolvedValue(mockTimelineEvents);
    mockApiPost.mockResolvedValue({});
    mockCreateResource.mockResolvedValue({ id: 'new-1', name: '新产品', status: 'Draft' });
    mockUpdateResource.mockResolvedValue({ id: '1', name: '更新名', status: 'Published' });
  });

  it('schema 加载成功后显示标题和列表', async () => {
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByText('产品')).toBeInTheDocument(); });
    expect(screen.getByTestId('list-engine')).toBeInTheDocument();
  });

  it('reference 字段自动生成 include 参数', async () => {
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(mockFetchResourceList).toHaveBeenCalled(); });
    const lastCall = mockFetchResourceList.mock.calls[mockFetchResourceList.mock.calls.length - 1];
    expect(lastCall[1].include).toHaveProperty('category');
  });

  it('新建记录：点击新建 → 表单打开 → 保存调用 createResource', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByText('新建 / 编辑'));
    await waitFor(() => { expect(screen.getByTestId('sheet')).toBeInTheDocument(); });
    expect(screen.getByTestId('sheet-title').textContent).toContain('新建');
    await user.click(screen.getByText(/保存/));
    await waitFor(() => { expect(mockCreateResource).toHaveBeenCalledWith('Product', expect.objectContaining({})); });
  });

  it('编辑记录：点击行 → 表单打开 → 保存调用 updateResource', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(screen.getByTestId('sheet')).toBeInTheDocument(); });
    expect(screen.getByTestId('sheet-title').textContent).toContain('编辑');
    await user.click(screen.getByText(/保存/));
    await waitFor(() => {
      expect(mockUpdateResource).toHaveBeenCalledWith('Product', 'row-1', expect.objectContaining({ id: 'row-1' }));
    });
  });

  it('保存后刷新列表', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    const initCount = mockFetchResourceList.mock.calls.length;
    await user.click(screen.getByText('新建 / 编辑'));
    await waitFor(() => { expect(screen.getByTestId('sheet')).toBeInTheDocument(); });
    await user.click(screen.getByText(/保存/));
    await waitFor(() => { expect(mockFetchResourceList.mock.calls.length).toBeGreaterThan(initCount); });
  });

  it('timeline 事件渲染', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => {
      expect(screen.getByText('CREATED')).toBeInTheDocument();
      expect(screen.getByText('admin')).toBeInTheDocument();
    });
  });

  it('timeline 为空显示占位', async () => {
    mockApiGet.mockResolvedValue({ data: { events: [] } });
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(screen.getByText('暂无时间线事件。')).toBeInTheDocument(); });
  });

  it('提交批注后调用 comment API', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(screen.getByPlaceholderText('写入团队批注...')).toBeInTheDocument(); });
    await user.type(screen.getByPlaceholderText('写入团队批注...'), '测试批注');
    await user.click(screen.getByText('发布批注'));
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v1/timeline/Product/row-1/comment', { content: '测试批注' });
    });
  });

  it('schema 加载失败显示错误', async () => {
    mockFetchSchema.mockRejectedValue(new Error('Network error'));
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByText('Network error')).toBeInTheDocument(); });
  });
});

/* ========================================================
   Smoke 2: 引用字段选择
   ======================================================== */

describe('Smoke · 引用字段选择', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockFetchSchema.mockResolvedValue(mockSchema);
    mockFetchResourceList.mockResolvedValue(mockListResponse);
    mockApiGet.mockResolvedValue(mockTimelineEvents);
    mockApiPost.mockResolvedValue({});
  });

  it('schema 含 reference 字段时 fetchResourceList 带 include', async () => {
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(mockFetchResourceList).toHaveBeenCalled(); });
    const call = mockFetchResourceList.mock.calls[0];
    expect(call[0]).toBe('Product');
    expect(call[1].include).toEqual({ category: true });
  });

  it('schema 无 reference 字段时 include 为空对象', async () => {
    const noRefSchema: UiSchema = {
      ...mockSchema,
      fields: mockSchema.fields.filter(f => f.type !== 'reference'),
      views: { ...mockSchema.views, list: { ...mockSchema.views.list, columns: ['id', 'name', 'status'] } },
    };
    mockFetchSchema.mockResolvedValue(noRefSchema);
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(mockFetchResourceList).toHaveBeenCalled(); });
    const call = mockFetchResourceList.mock.calls[0];
    expect(call[1].include).toEqual({});
  });
});

/* ========================================================
   Smoke 3: 登录页
   ======================================================== */

// authStore mock — 同时支持 Login (setAuth) 和 OrderDetail (currentCompanyId)
const mockSetAuth = jest.fn();
jest.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: any) => selector({
      setAuth: mockSetAuth,
      currentCompanyId: 'c1',
      token: 'test-token',
      user: { id: 'u1', username: 'admin', role: 'admin' },
      companies: [{ id: 'c1', name: 'TestCo', role: 'owner' }],
    }),
    { getState: jest.fn() },
  ),
}));

// 登录页需要单独 mock api（post）
// 已在顶部 mock 了 api.default

import LoginPage from '@/app/login/page';

describe('Smoke · 登录页', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockApiPost.mockResolvedValue({
      data: {
        accessToken: 'jwt-token-abc',
        user: { id: 'u1', username: 'admin', role: 'admin' },
        companies: [{ id: 'c1', name: 'TestCo', role: 'owner' }],
      },
    });
  });

  it('渲染标题和默认账号', () => {
    render(<LoginPage />);
    expect(screen.getByText('智能制造 EIP 全局系统')).toBeInTheDocument();
    const emailInput = screen.getByPlaceholderText('请输入账号') as HTMLInputElement;
    expect(emailInput.value).toBe('admin@erp.com');
  });

  it('登录成功调用 API → setAuth → 跳转', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText('安全登入'));
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/auth/login', { email: 'admin@erp.com', password: 'admin' });
    });
    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalledWith('jwt-token-abc', expect.any(Object), expect.any(Array));
    });
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('登录失败显示错误', async () => {
    mockApiPost.mockRejectedValueOnce({ response: { data: { message: '用户名或密码错误' } } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText('安全登入'));
    await waitFor(() => {
      expect(screen.getByText('用户名或密码错误')).toBeInTheDocument();
    });
  });
});

/* ========================================================
   Smoke 4: 订单详情 Timeline
   ======================================================== */

const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: (...a: any[]) => mockToastError(...a), success: (...a: any[]) => mockToastSuccess(...a) },
}));

const mockOrderData = {
  id: 'order-001', orderNo: 'SO-2025-0001', status: 'DRAFT', totalAmount: 50000,
  expectedDate: '2025-06-01T00:00:00Z', notes: '优先安排', createdAt: '2025-01-15T08:00:00Z',
  partner: { id: 'p1', name: '测试客户A', contact: '张三', phone: '13800000000' },
  salesPerson: { id: 'sp1', name: '李销售' },
  items: [{ id: 'item-1', productId: 'PROD-001', quantity: 10, unitPrice: 5000, totalPrice: 50000 }],
  workOrders: [], invoices: [],
};

import OrderDetailPage from '@/app/dashboard/orders/[id]/page';

describe('Smoke · 订单详情 Timeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: mockOrderData });
      if (url === '/orders/order-001/timeline') return Promise.resolve({
        data: { events: [{ id: 'ev1', action: 'CREATED', createdAt: '2025-01-15T08:00:00Z', user: { name: 'admin' } }] },
      });
      return Promise.resolve({ data: {} });
    });
    mockApiPost.mockResolvedValue({});
  });

  it('加载订单号和状态', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => { expect(screen.getByText('SO-2025-0001')).toBeInTheDocument(); });
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('Timeline 事件渲染', async () => {
    render(<OrderDetailPage />);
    await waitFor(() => { expect(screen.getByText('CREATED')).toBeInTheDocument(); });
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('Timeline 为空显示占位', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.resolve({ data: mockOrderData });
      return Promise.resolve({ data: { events: [] } });
    });
    render(<OrderDetailPage />);
    await waitFor(() => { expect(screen.getByText('暂无动态记录。')).toBeInTheDocument(); });
  });

  it('状态流转触发 workflow API', async () => {
    const user = userEvent.setup();
    render(<OrderDetailPage />);
    await waitFor(() => { expect(screen.getByText('提交订单')).toBeInTheDocument(); });
    await user.click(screen.getByText('提交订单'));
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v1/workflow/order/order-001/transition', { action: 'submit' });
    });
  });

  it('加载失败跳转回列表', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/orders/order-001') return Promise.reject(new Error('fail'));
      return Promise.resolve({ data: { events: [] } });
    });
    render(<OrderDetailPage />);
    await waitFor(() => { expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/orders'); });
  });
});
