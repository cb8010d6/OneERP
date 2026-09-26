import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import api from '@/lib/api';
import SalesModulePage from '../page';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('@/components/sales/SaleOrderDrawer', () => ({
  SaleOrderDrawer: () => null,
}));

const mockedApi = api as jest.Mocked<typeof api>;

type SalesRow = {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  expectedDate: string | null;
  createdAt: string;
};

function result(
  data: SalesRow[] = [],
  page = 1,
  total = 201,
  limit = 100,
) {
  return {
    data,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

function order(orderNo: string): SalesRow {
  return {
    id: orderNo,
    orderNo,
    status: 'DRAFT',
    totalAmount: 100,
    expectedDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function latestParams() {
  return mockedApi.get.mock.calls.at(-1)?.[1]?.params as
    | { page: number; limit: number; search?: string; status?: string }
    | undefined;
}

describe('SalesModulePage pagination and requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests and displays the second API page', async () => {
    mockedApi.get.mockImplementation((_url, config) => {
      const page = Number(config?.params?.page ?? 1);
      return Promise.resolve({ data: result([], page) } as never);
    });

    render(<SalesModulePage />);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(latestParams()?.page).toBe(2));
    expect(latestParams()?.limit).toBe(100);
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
  });

  it('resets to page one when status or search changes', async () => {
    mockedApi.get.mockImplementation((_url, config) => {
      const page = Number(config?.params?.page ?? 1);
      return Promise.resolve({ data: result([], page) } as never);
    });

    render(<SalesModulePage />);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(latestParams()?.page).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: '草稿待确认' }));
    await waitFor(() => {
      expect(latestParams()).toEqual(
        expect.objectContaining({ page: 1, status: 'DRAFT' }),
      );
    });

    fireEvent.change(screen.getByPlaceholderText('搜索单号、客户...'), {
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

    render(<SalesModulePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '订单列表加载失败',
    );
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(
      await screen.findByRole('button', { name: '打开订单 SO-RETRY' }),
    ).toBeInTheDocument();
  });

  it('ignores a response from an older search after the new search succeeds', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    const oldRequest = new Promise<unknown>((resolve) => {
      resolveOld = resolve;
    });
    mockedApi.get
      .mockReturnValueOnce(oldRequest as never)
      .mockResolvedValueOnce({ data: result([order('SO-NEW')], 1, 1) } as never);

    render(<SalesModulePage />);
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('搜索单号、客户...'), {
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
        return Promise.resolve({ data: result([], 3, 200) } as never);
      }
      const total = totalHasChanged ? 200 : 201;
      const response = result([], page, total);
      return Promise.resolve({ data: response } as never);
    });

    render(<SalesModulePage />);
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
