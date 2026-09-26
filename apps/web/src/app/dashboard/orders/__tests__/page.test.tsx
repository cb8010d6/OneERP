import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '@/lib/api';
import OrdersPage from '../page';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

type OrderRow = {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  expectedDate: string | null;
  fulfillmentSummary: {
    overallStatus: 'READY';
    lineCount: number;
    shortageLineCount: number;
    unmappedLineCount: number;
    totalShortageQty: number;
  };
  fulfillmentEvidence?: unknown;
};

function result(
  data: OrderRow[] = [],
  page = 1,
  total = 101,
  limit = 50,
) {
  return {
    data,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

function order(orderNo: string): OrderRow {
  return {
    id: orderNo,
    orderNo,
    status: 'PENDING',
    totalAmount: 100,
    expectedDate: null,
    fulfillmentSummary: {
      overallStatus: 'READY',
      lineCount: 1,
      shortageLineCount: 0,
      unmappedLineCount: 0,
      totalShortageQty: 0,
    },
  };
}

function fulfillmentEvidence(
  assessment: string,
  groupAssessments: string[] = [],
) {
  return {
    assessment,
    issues: [],
    materialDemandGroups: groupAssessments.map((groupAssessment, index) => ({
      materialId: `material-${index}`,
      materialName: `Material ${index}`,
      materialSku: `SKU-${index}`,
      materialUnit: 'pcs',
      orderItemIds: [`item-${index}`],
      productIds: [`product-${index}`],
      orderedQty: 1000,
      netShippedQty: 0,
      remainingQty: 1000,
      onHandQty: 0,
      openWorkOrderQty: 0,
      onHandGapQty: 1000,
      projectedGapQty: 1000,
      assessment: groupAssessment,
      issues: [],
    })),
    stockBasis: 'UNRESERVED_SNAPSHOT',
    workOrderBasis: 'UNFINISHED_NOT_ETA',
  };
}

function latestParams() {
  return mockedApi.get.mock.calls.at(-1)?.[1]?.params as
    | { page: number; limit: number; search?: string; status?: string }
    | undefined;
}

describe('OrdersPage pagination and requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests and displays the second API page', async () => {
    mockedApi.get.mockImplementation((_url, config) => {
      const page = Number(config?.params?.page ?? 1);
      return Promise.resolve({ data: result([], page) } as never);
    });

    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(latestParams()?.page).toBe(2));
    expect(latestParams()?.limit).toBe(50);
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
  });

  it('resets to page one when status or search changes', async () => {
    mockedApi.get.mockImplementation((_url, config) => {
      const page = Number(config?.params?.page ?? 1);
      return Promise.resolve({ data: result([], page) } as never);
    });

    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(latestParams()?.page).toBe(2));

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'DRAFT' },
    });
    await waitFor(() => {
      expect(latestParams()).toEqual(
        expect.objectContaining({ page: 1, status: 'DRAFT' }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText('搜索订单号或客户'), {
      target: { value: 'SO-12' },
    });
    await waitFor(() => {
      expect(latestParams()).toEqual(
        expect.objectContaining({ page: 1, status: 'DRAFT', search: 'SO-12' }),
      );
    });
  });

  it('shows a retry action after an error and recovers when retried', async () => {
    mockedApi.get
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: result([order('SO-RETRY')], 1, 1) } as never);

    render(<OrdersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '订单列表加载失败',
    );
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(
      await screen.findByRole('button', { name: '打开订单 SO-RETRY' }),
    ).toBeInTheDocument();
  });

  it('does not use legacy READY or shortage totals when evidence is missing', async () => {
    mockedApi.get.mockResolvedValue({
      data: result([order('SO-LEGACY')], 1, 1),
    } as never);

    render(<OrdersPage />);

    expect(await screen.findByRole('button', { name: '打开订单 SO-LEGACY' })).toBeInTheDocument();
    expect(screen.getAllByText('评估未知')).toHaveLength(2);
    expect(screen.getByText('数据复核 / 未知订单').parentElement).toHaveTextContent('1');
    expect(screen.queryByText('现货可交')).not.toBeInTheDocument();
    expect(screen.queryByText('生产覆盖')).not.toBeInTheDocument();
  });

  it('counts additive assessments and problem material groups without summing quantities', async () => {
    const row = {
      ...order('SO-EVIDENCE'),
      fulfillmentEvidence: fulfillmentEvidence('SHORTAGE', [
        'SHORTAGE',
        'ON_HAND_COVERAGE',
      ]),
    };
    mockedApi.get.mockResolvedValue({
      data: result([row], 1, 1),
    } as never);

    render(<OrdersPage />);

    expect(await screen.findByRole('button', { name: '打开订单 SO-EVIDENCE' })).toBeInTheDocument();
    expect(screen.getByText('缺口评估订单').parentElement).toHaveTextContent('1');
    expect(screen.getAllByText('缺口或复核物料组').some((label) =>
      label.parentElement?.textContent?.includes('1'),
    )).toBe(true);
    expect(screen.queryByText('1000')).not.toBeInTheDocument();
  });

  it('does not present failed list or stale page assessments as zero counts', async () => {
    mockedApi.get.mockRejectedValue(new Error('offline'));

    render(<OrdersPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('订单列表加载失败');
    expect(screen.getByText('数据复核 / 未知订单').parentElement).toHaveTextContent('—');
    expect(screen.getByText('本页订单数').parentElement).toHaveTextContent('—');
  });

  it('ignores a response from an older search after the new search succeeds', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    const oldRequest = new Promise<unknown>((resolve) => {
      resolveOld = resolve;
    });
    mockedApi.get
      .mockReturnValueOnce(oldRequest as never)
      .mockResolvedValueOnce({ data: result([order('SO-NEW')], 1, 1) } as never);

    render(<OrdersPage />);
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('搜索订单号或客户'), {
      target: { value: 'new' },
    });
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('button', { name: '打开订单 SO-NEW' }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveOld?.({ data: result([order('SO-OLD')], 1, 1) });
    });
    expect(screen.queryByText('SO-OLD')).not.toBeInTheDocument();
  });

  it('recovers when the current last page no longer exists', async () => {
    let totalHasChanged = false;
    mockedApi.get.mockImplementation((_url, config) => {
      const page = Number(config?.params?.page ?? 1);
      if (page === 3) {
        totalHasChanged = true;
        return Promise.resolve({ data: result([], 3, 60) } as never);
      }
      const total = totalHasChanged ? 60 : 101;
      const response = result([], page, total);
      return Promise.resolve({ data: response } as never);
    });

    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(latestParams()?.page).toBe(2));
    await screen.findByText('2 / 3');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(latestParams()?.page).toBe(3));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(4));
    expect(latestParams()?.page).toBe(2);
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();
  });
});
