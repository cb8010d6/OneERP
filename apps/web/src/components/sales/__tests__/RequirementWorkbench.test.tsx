import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RequirementWorkbench,
  requirementStatusLabel,
} from '../RequirementWorkbench';
import { useAuthStore } from '@/store/authStore';

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('@/components/core/AsyncSelect', () => ({
  AsyncSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('partner-1')}>
      选择示例客户
    </button>
  ),
}));

describe('RequirementWorkbench', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      token: 'test-token',
      user: { id: 'user-1', email: 'admin@example.com' },
      companies: [
        {
          id: 'company-1',
          name: '测试公司',
          role: 'SuperAdmin',
          permissions: ['ALL'],
        },
      ],
      currentCompanyId: 'company-1',
    });
    mockGet.mockResolvedValue({
      data: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
    });
    mockPost.mockResolvedValue({
      data: {
        id: 'requirement-1',
        requirementNo: 'REQ-2026-000001',
        status: 'DRAFT',
      },
    });
  });

  it('renders readable status labels and retries a failed load', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        data: {
          data: [requirementWithContract('ACTIVE')],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        },
      });
    const user = userEvent.setup();
    render(<RequirementWorkbench />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '客户需求加载失败：network unavailable',
    );
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect((await screen.findAllByText('报价中')).length).toBeGreaterThan(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('maps known requirement statuses while preserving unknown ones', () => {
    expect(requirementStatusLabel('FOLLOWING')).toBe('跟进中');
    expect(requirementStatusLabel('CONVERTED')).toBe('已转化');
    expect(requirementStatusLabel('CUSTOM')).toBe('CUSTOM');
  });

  it('debounces requirement searches before requesting filtered data', async () => {
    jest.useFakeTimers();
    try {
      render(<RequirementWorkbench />);
      await act(async () => undefined);
      expect(mockGet).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByPlaceholderText('搜索单号、客户或摘要'), {
        target: { value: 'REQ-2026' },
      });
      act(() => jest.advanceTimersByTime(349));
      expect(mockGet).toHaveBeenCalledTimes(1);

      await act(async () => jest.advanceTimersByTime(1));
      expect(mockGet).toHaveBeenLastCalledWith(
        '/presales/requirements?page=1&limit=100&search=REQ-2026',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores an older request that finishes after a newer filter result', async () => {
    let resolveInitialRequest: (value: unknown) => void = () => undefined;
    mockGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialRequest = resolve;
          }),
      )
      .mockResolvedValueOnce({
        data: {
          data: [requirementWithContract('ACTIVE')],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        },
      });
    render(<RequirementWorkbench />);

    fireEvent.change(screen.getByRole('combobox', { name: '需求状态' }), {
      target: { value: 'QUOTING' },
    });
    expect(await screen.findByText('REQ-2026-000003')).toBeInTheDocument();

    await act(async () => {
      resolveInitialRequest({
        data: { data: [], total: 0, page: 1, limit: 100, totalPages: 1 },
      });
    });
    expect(screen.getByText('REQ-2026-000003')).toBeInTheDocument();
  });

  it('creates a customer requirement through the public API', async () => {
    const user = userEvent.setup();
    render(<RequirementWorkbench />);

    await user.click(screen.getByText('新建客户需求'));
    await user.click(screen.getByText('选择示例客户'));
    await user.type(screen.getByLabelText('来源渠道'), '客户来电');
    await user.type(screen.getByLabelText('需求摘要'), '需要定制一批设备零件');
    await user.click(screen.getByText('创建需求单'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/presales/requirements', {
        partnerId: 'partner-1',
        sourceChannel: '客户来电',
        summary: '需要定制一批设备零件',
        estimatedAmount: undefined,
        expectedCloseDate: undefined,
        nextFollowUpAt: undefined,
      });
    });
  });

  it('registers Contract V1 from an accepted quote version', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'requirement-1',
            requirementNo: 'REQ-2026-000001',
            status: 'QUOTING',
            sourceChannel: '客户来电',
            summary: '设备零件',
            estimatedAmount: 250,
            expectedCloseDate: null,
            nextFollowUpAt: null,
            closeReason: null,
            updatedAt: '2026-07-11T00:00:00.000Z',
            partner: { id: 'partner-1', name: '示例客户' },
            owner: { id: 'owner-1', name: '销售员', email: 'sales@example.com' },
            quotes: [
              {
                id: 'quote-1',
                quoteNo: 'QT-2026-000001',
                currentVersionNo: 2,
                versions: [
                  {
                    id: 'version-2',
                    versionNo: 2,
                    status: 'ACCEPTED',
                    currencyCode: 'CNY',
                    total: 250,
                    validUntil: '2026-08-01T00:00:00.000Z',
                    contract: null,
                  },
                ],
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });
    const user = userEvent.setup();
    render(<RequirementWorkbench />);

    await user.click(await screen.findByText('登记合同 V1'));
    expect(screen.getByLabelText('合同标题')).toHaveValue(
      'QT-2026-000001 销售合同',
    );
    await user.click(
      within(
        screen.getByRole('dialog', { name: '登记合同 V1' }),
      ).getByRole('button', { name: '登记合同 V1' }),
    );

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/presales/contracts/from-quote-version/version-2',
        expect.objectContaining({
          title: 'QT-2026-000001 销售合同',
          effectiveAt: expect.any(String),
          expiresAt: undefined,
        }),
      );
    });
  });

  it('uploads and binds a signed contract file', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'requirement-1',
            requirementNo: 'REQ-2026-000002',
            status: 'QUOTING',
            sourceChannel: '客户来电',
            summary: '已批准合同',
            estimatedAmount: 100000,
            expectedCloseDate: null,
            nextFollowUpAt: null,
            closeReason: null,
            updatedAt: '2026-07-12T00:00:00.000Z',
            partner: { id: 'partner-1', name: '示例客户' },
            owner: { id: 'owner-1', name: '销售员', email: 'sales@example.com' },
            quotes: [
              {
                id: 'quote-1',
                quoteNo: 'QT-2026-000002',
                currentVersionNo: 2,
                versions: [
                  {
                    id: 'version-2',
                    versionNo: 2,
                    status: 'ACCEPTED',
                    currencyCode: 'CNY',
                    total: 100000,
                    validUntil: '2026-08-01T00:00:00.000Z',
                    contract: {
                      id: 'contract-1',
                      contractNo: 'CT-2026-000002',
                      status: 'APPROVED',
                      currentVersionNo: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    });
    mockPost.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/files/upload')
          ? { data: { id: 'file-1' } }
          : { data: { status: 'SIGNED' } },
      ),
    );
    const user = userEvent.setup();
    render(<RequirementWorkbench />);

    await user.click(await screen.findByText('上传签署件'));
    const file = new File(['%PDF-1.4 signed'], 'signed-contract.pdf', {
      type: 'application/pdf',
    });
    await user.upload(screen.getByLabelText('签署件'), file);
    await user.click(screen.getByRole('button', { name: '确认签署并归档' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/presales/contracts/contract-1/sign',
        { fileRecordId: 'file-1' },
      );
    });
  });

  it('creates an order batch from the active contract preview', async () => {
    mockGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('order-conversion-preview')
          ? {
              data: {
                contractId: 'contract-1',
                contractNo: 'CT-2026-000003',
                status: 'ACTIVE',
                items: [
                  {
                    quoteVersionItemId: 'quote-item-1',
                    productId: 'product-1',
                    sku: 'P-001',
                    name: '设备零件',
                    uom: 'pcs',
                    unitPrice: '100',
                    contractedQuantity: '10',
                    allocatedQuantity: '4',
                    remainingQuantity: '6',
                  },
                ],
              },
            }
          : {
              data: {
                data: [requirementWithContract('ACTIVE')],
                total: 1,
                page: 1,
                limit: 100,
                totalPages: 1,
              },
            },
      ),
    );
    mockPost.mockResolvedValue({
      data: {
        order: { orderNo: 'ORD-2026-COMPAN-000001' },
        idempotentReplay: false,
      },
    });
    const user = userEvent.setup();
    render(<RequirementWorkbench />);

    await user.click(await screen.findByText('创建订单批次'));
    expect(screen.getByLabelText('稳定批次键')).toHaveValue(
      'CT-2026-000003-BATCH-01',
    );
    const quantity = screen.getByLabelText('本批数量');
    await user.clear(quantity);
    await user.type(quantity, '2');
    await user.click(screen.getByRole('button', { name: '创建销售订单' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/presales/contracts/contract-1/order-batches',
        {
          sourceBatchKey: 'CT-2026-000003-BATCH-01',
          items: [{ quoteVersionItemId: 'quote-item-1', quantity: 2 }],
        },
      );
    });
  });
});

function requirementWithContract(status: string) {
  return {
    id: 'requirement-1',
    requirementNo: 'REQ-2026-000003',
    status: 'QUOTING',
    sourceChannel: '客户来电',
    summary: '生效合同',
    estimatedAmount: 100000,
    expectedCloseDate: null,
    nextFollowUpAt: null,
    closeReason: null,
    updatedAt: '2026-07-12T00:00:00.000Z',
    partner: { id: 'partner-1', name: '示例客户' },
    owner: { id: 'owner-1', name: '销售员', email: 'sales@example.com' },
    quotes: [
      {
        id: 'quote-1',
        quoteNo: 'QT-2026-000003',
        currentVersionNo: 2,
        versions: [
          {
            id: 'version-2',
            versionNo: 2,
            status: 'ACCEPTED',
            currencyCode: 'CNY',
            total: 100000,
            validUntil: '2026-08-01T00:00:00.000Z',
            contract: {
              id: 'contract-1',
              contractNo: 'CT-2026-000003',
              status,
              currentVersionNo: 1,
              signedFileId: 'file-1',
            },
          },
        ],
      },
    ],
  };
}
