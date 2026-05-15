/**
 * DynamicView.tsx — 最小回归测试
 *
 * 覆盖:
 *  1. 初始渲染：schema 加载 → 显示标题 → list 视图
 *  2. 引用字段：reference 字段在 fetchResourceList 中自动生成 include
 *  3. 保存：新建（无 id）→ createResource / 编辑（有 id）→ updateResource
 *  4. Timeline：打开记录后加载事件 / 提交批注后刷新
 *  5. 错误态：schema / 数据加载失败
 */

/* ---------- Mock localStorage ---------- */
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


/* ---------- Mock API functions ---------- */
const mockFetchSchema = jest.fn();
const mockFetchResourceList = jest.fn();
const mockCreateResource = jest.fn();
const mockUpdateResource = jest.fn();
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();

jest.mock('@/lib/dynamic-resource', () => ({
  fetchSchema: (...a: any[]) => mockFetchSchema(...a),
  fetchResourceList: (...a: any[]) => mockFetchResourceList(...a),
  createResource: (...a: any[]) => mockCreateResource(...a),
  updateResource: (...a: any[]) => mockUpdateResource(...a),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...a: any[]) => mockApiGet(...a),
    post: (...a: any[]) => mockApiPost(...a),
  },
}));

/* ---------- Mock 子组件 ---------- */
jest.mock('../ListEngine', () => ({
  ListEngine: ({ onRowClick, onSearchChange }: any) => (
    <div data-testid="list-engine">
      <button data-testid="row-click" onClick={() => onRowClick?.({ id: 'row-1', name: 'Test Row' })}>row</button>
      <input data-testid="search-input" onChange={(e: any) => onSearchChange?.(e.target.value)} />
    </div>
  ),
}));
jest.mock('../KanbanEngine', () => ({ KanbanEngine: () => <div data-testid="kanban-engine" /> }));
jest.mock('../FormEngine', () => ({
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

/* ---------- 测试数据 ---------- */
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

const mockTimelineEvents = {
  data: {
    events: [
      { id: 'ev1', action: 'CREATED', createdAt: '2025-01-01T00:00:00Z', user: { name: 'admin' } },
      { id: 'ev2', action: 'UPDATED', createdAt: '2025-01-02T00:00:00Z', user: { email: 'user@test.com' } },
    ],
  },
};

/* ---------- Tests ---------- */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicView } from '../DynamicView';
import { useAuthStore } from '@/store/authStore';

describe('DynamicView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      token: 'test-token',
      user: { id: 'user-1', email: 'admin@test.com' },
      companies: [
        {
          id: 'company-1',
          name: '测试公司',
          role: 'Admin',
          permissions: ['product:create', 'product:update'],
        },
      ],
      currentCompanyId: 'company-1',
    });
    mockFetchSchema.mockResolvedValue(mockSchema);
    mockFetchResourceList.mockResolvedValue(mockListResponse);
    mockApiGet.mockResolvedValue(mockTimelineEvents);
    mockApiPost.mockResolvedValue({});
    mockCreateResource.mockResolvedValue({ id: 'new-1', name: '新产品', status: 'Draft' });
    mockUpdateResource.mockResolvedValue({ id: '1', name: '更新名', status: 'Published' });
  });

  it('加载中显示 skeleton', () => {
    mockFetchSchema.mockReturnValue(new Promise(() => {}));
    render(<DynamicView modelName="Product" />);
    expect(screen.getByText('元数据加载中...')).toBeInTheDocument();
  });

  it('schema 加载成功后显示标题', async () => {
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByText('产品')).toBeInTheDocument(); });
    expect(screen.getByTestId('list-engine')).toBeInTheDocument();
  });

  it('自定义 title 覆盖 schema.label', async () => {
    render(<DynamicView modelName="Product" title="我的产品" />);
    await waitFor(() => { expect(screen.getByText('我的产品')).toBeInTheDocument(); });
  });

  it('reference 字段自动生成 include 参数', async () => {
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(mockFetchResourceList).toHaveBeenCalled(); });
    const lastCall = mockFetchResourceList.mock.calls[mockFetchResourceList.mock.calls.length - 1];
    expect(lastCall[1].include).toHaveProperty('category');
  });

  it('新建记录调用 createResource', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByText('新建 / 编辑'));
    await waitFor(() => { expect(screen.getByTestId('sheet')).toBeInTheDocument(); });
    await user.click(screen.getByText(/保存/));
    await waitFor(() => { expect(mockCreateResource).toHaveBeenCalledWith('Product', expect.objectContaining({})); });
  });

  it('编辑记录调用 updateResource', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(screen.getByTestId('sheet')).toBeInTheDocument(); });
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

  it('打开记录后加载 timeline', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(mockApiGet).toHaveBeenCalledWith('/v1/timeline/Product/row-1'); });
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

  it('数据加载失败显示错误', async () => {
    mockFetchResourceList.mockRejectedValue(new Error('Server error'));
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByText('Server error')).toBeInTheDocument(); });
  });

  it('新建时标题含"新建"', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByText('新建 / 编辑'));
    await waitFor(() => { expect(screen.getByTestId('sheet-title').textContent).toContain('新建'); });
  });

  it('编辑时标题含"编辑"', async () => {
    const user = userEvent.setup();
    render(<DynamicView modelName="Product" />);
    await waitFor(() => { expect(screen.getByTestId('list-engine')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('row-click'));
    await waitFor(() => { expect(screen.getByTestId('sheet-title').textContent).toContain('编辑'); });
  });
});
