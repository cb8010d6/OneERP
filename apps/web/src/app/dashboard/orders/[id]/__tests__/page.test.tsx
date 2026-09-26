import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { FulfillmentEvidence } from '@/lib/order-fulfillment-evidence';
import OrderDetailPage from '../page';

let mockOrderId = 'A';
let mockOnPosted: () => void;
let mockOnReversed: () => void;

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: mockOrderId }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('../SalesShipmentPanel', () => ({
  SalesShipmentPanel: ({ onPosted }: { onPosted: () => void }) => {
    mockOnPosted = onPosted;
    return null;
  },
}));
jest.mock('../SalesShipmentReversalPanel', () => ({
  SalesShipmentReversalPanel: ({ onReversed }: { onReversed: () => void }) => {
    mockOnReversed = onReversed;
    return null;
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
type Response = Awaited<ReturnType<typeof api.get>>;
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    promise,
    resolve: (data: unknown) => resolve({ data } as Response),
    reject: () => reject(new Error('read unavailable')),
  };
}

function order(id: string, status = 'PARTIAL_SHIPPED') {
  return {
    id, orderNo: `SO-${id}`, status, totalAmount: 10,
    expectedDate: null, notes: null, createdAt: '2026-07-01T12:00:00Z',
    partner: { id: 'partner', name: 'Customer', contact: '', phone: '' },
    salesPerson: { id: 'sales', name: 'Seller' },
    items: [{ id: 'line', productId: 'product', quantity: 10, unitPrice: 1, totalPrice: 10 }],
    workOrders: [{ id: 'wo', workOrderNo: 'WO-1', status: 'IN_PROGRESS', plannedQty: 10, actualQty: 3 }],
    invoices: [],
  };
}

function evidence(label: string): FulfillmentEvidence {
  return {
    assessment: 'WORK_ORDER_COVERAGE', issues: [],
    stockBasis: 'UNRESERVED_SNAPSHOT', workOrderBasis: 'UNFINISHED_NOT_ETA',
    materialDemandGroups: [{
      materialId: 'material', materialName: label, materialSku: null, materialUnit: null,
      orderItemIds: ['line'], productIds: ['product'], orderedQty: 10,
      netShippedQty: 6, remainingQty: 4, onHandQty: 0, openWorkOrderQty: 4,
      onHandGapQty: 4, projectedGapQty: 0, assessment: 'WORK_ORDER_COVERAGE', issues: [],
    }],
  };
}

const requests = new Map<string, ReturnType<typeof deferred>[]>();
function queueReads(id: string, label = `${id} evidence`, status = 'PARTIAL_SHIPPED') {
  const reads = [deferred(), deferred(), deferred()];
  const urls = [`/orders/${id}`, `/orders/${id}/fulfillment-availability`, `/orders/${id}/timeline`];
  urls.forEach((url, index) => requests.set(url, [...(requests.get(url) ?? []), reads[index]]));
  return {
    reads,
    succeed: () => {
      reads[0].resolve(order(id, status));
      reads[1].resolve({ fulfillmentEvidence: evidence(label) });
      reads[2].resolve({ events: [{ id: label, action: `${label} event`, createdAt: '2026-07-01T12:00:00Z' }] });
    },
  };
}

function expectReadCount(id: string, count: number) {
  for (const suffix of ['', '/fulfillment-availability', '/timeline']) {
    expect(mockedApi.get.mock.calls.filter(([url]) => url === `/orders/${id}${suffix}`)).toHaveLength(count);
  }
}

async function loadA(status = 'PARTIAL_SHIPPED') {
  const initial = queueReads('A', 'A evidence', status);
  const view = render(<OrderDetailPage />);
  await act(async () => initial.succeed());
  expect(await screen.findByRole('heading', { name: '订单 SO-A' })).toBeInTheDocument();
  return view;
}

describe('OrderDetailPage authoritative reads', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    requests.clear();
    mockOrderId = 'A';
    localStorage.clear();
    useAuthStore.setState({
      token: 'token-1', user: { id: 'user-1' }, currentCompanyId: 'company-1', contextVersion: 1,
      companies: [
        { id: 'company-1', name: 'First', role: 'admin', permissions: ['*:*'] },
        { id: 'company-2', name: 'Second', role: 'admin', permissions: ['*:*'] },
      ],
    });
    mockedApi.get.mockImplementation((url) => {
      const request = requests.get(url)?.shift();
      if (!request) throw new Error(`Unexpected GET ${url}`);
      return request.promise;
    });
  });

  it('loads the order, additive evidence, timeline, and actual work-order quantity', async () => {
    await loadA();
    expectReadCount('A', 1);
    expect(screen.getByText('A evidence')).toBeInTheDocument();
    expect(screen.getByText('A evidence event')).toBeInTheDocument();
    expect(screen.getByText('完成: 3')).toBeInTheDocument();
  });

  it('refetches all three authorities after posting and reversal callbacks', async () => {
    await loadA();
    for (const [index, callback] of [mockOnPosted, mockOnReversed].entries()) {
      const label = `refreshed-${index}`;
      const next = queueReads('A', label);
      act(() => callback());
      expectReadCount('A', index + 2);
      expect(screen.queryByText('A evidence')).not.toBeInTheDocument();
      await act(async () => next.succeed());
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByText(`${label} event`)).toBeInTheDocument();
    }
  });

  it('does not start authoritative reads when a captured mutation callback fires after unmount', async () => {
    const view = await loadA();
    const callback = mockOnPosted;

    view.unmount();
    act(() => callback());

    expectReadCount('A', 1);
  });

  it('clears previously good evidence and reports failed timeline reads as failure, not empty', async () => {
    await loadA();
    const next = queueReads('A');
    act(() => mockOnPosted());
    expect(screen.queryByText('A evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('A evidence event')).not.toBeInTheDocument();
    await act(async () => {
      next.reads[0].resolve(order('A'));
      next.reads[1].reject();
      next.reads[2].reject();
    });
    expect(await screen.findByText(/履约证据读取失败/)).toBeInTheDocument();
    expect(screen.getByText('动态时间线读取失败，不能将其视为无记录。')).toBeInTheDocument();
    expect(screen.queryByText('暂无动态记录。')).not.toBeInTheDocument();
    expect(screen.queryByText('A evidence')).not.toBeInTheDocument();
  });

  it('keeps server status authoritative after a successful workflow mutation', async () => {
    await loadA('DRAFT');
    const next = queueReads('A', 'after workflow', 'DRAFT');
    const post = deferred();
    mockedApi.post.mockReturnValue(post.promise);
    fireEvent.click(screen.getByRole('button', { name: '提交订单' }));
    expect(mockedApi.post).toHaveBeenCalledWith('/v1/workflow/order/A/transition', { action: 'submit' });
    await act(async () => post.resolve({ status: 'PENDING' }));
    expectReadCount('A', 2);
    expect(screen.getByText('草稿')).toBeInTheDocument();
    expect(screen.queryByText('待处理')).not.toBeInTheDocument();
    await act(async () => next.succeed());
    expect(await screen.findByText('after workflow')).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('ignores late initial A responses after navigation to B', async () => {
    const a = queueReads('A');
    const view = render(<OrderDetailPage />);
    const b = queueReads('B');
    mockOrderId = 'B';
    view.rerender(<OrderDetailPage />);
    await act(async () => b.succeed());
    expect(await screen.findByText('B evidence')).toBeInTheDocument();
    await act(async () => a.succeed());
    expect(screen.getByRole('heading', { name: '订单 SO-B' })).toBeInTheDocument();
    expect(screen.getByText('B evidence event')).toBeInTheDocument();
    expect(screen.queryByText('A evidence')).not.toBeInTheDocument();
    expectReadCount('A', 1);
    expectReadCount('B', 1);
  });

  it('does not let a captured A callback clear or supersede an in-flight B read in the same company', async () => {
    const view = await loadA();
    const oldCallbacks = [mockOnPosted, mockOnReversed];
    const b = queueReads('B');
    mockOrderId = 'B';
    view.rerender(<OrderDetailPage />);
    await waitFor(() => expectReadCount('B', 1));
    act(() => oldCallbacks.forEach((callback) => callback()));
    expectReadCount('A', 1);
    expectReadCount('B', 1);
    await act(async () => b.succeed());
    expect(await screen.findByRole('heading', { name: '订单 SO-B' })).toBeInTheDocument();
    expect(screen.getByText('B evidence')).toBeInTheDocument();
    act(() => oldCallbacks.forEach((callback) => callback()));
    expect(screen.getByText('B evidence')).toBeInTheDocument();
    expect(screen.getByText('B evidence event')).toBeInTheDocument();
    expectReadCount('A', 1);
    expectReadCount('B', 1);
  });

  it('preserves valid callback refreshes and in-flight reads across same-identity token rotation', async () => {
    await loadA();
    const callback = mockOnPosted;
    const next = queueReads('A', 'rotated-token evidence');
    act(() => {
      const auth = useAuthStore.getState();
      auth.setAuth('token-2', { id: 'user-1' }, auth.companies);
    });
    expect(useAuthStore.getState().contextVersion).toBe(1);
    expectReadCount('A', 1);
    expect(screen.getByText('A evidence')).toBeInTheDocument();
    act(() => callback());
    expectReadCount('A', 2);
    act(() => {
      const auth = useAuthStore.getState();
      auth.setAuth('token-3', { id: 'user-1' }, auth.companies);
    });
    await act(async () => next.succeed());
    expect(await screen.findByText('rotated-token evidence')).toBeInTheDocument();
    expectReadCount('A', 2);
  });

  it('ignores callbacks from previous company, user, or context-version identities', async () => {
    await loadA();
    const changes = [
      () => useAuthStore.getState().setCurrentCompany('company-2'),
      () => {
        const auth = useAuthStore.getState();
        auth.setAuth('different-user-token', { id: 'user-2' }, auth.companies);
      },
      () => useAuthStore.setState({ contextVersion: useAuthStore.getState().contextVersion + 1 }),
    ];
    for (const [index, change] of changes.entries()) {
      const oldCallbacks = [mockOnPosted, mockOnReversed];
      const label = `new identity ${index}`;
      const next = queueReads('A', label);
      act(change);
      await waitFor(() => expectReadCount('A', index + 2));
      act(() => oldCallbacks.forEach((callback) => callback()));
      expectReadCount('A', index + 2);
      await act(async () => next.succeed());
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByText(`${label} event`)).toBeInTheDocument();
    }
  });
});
