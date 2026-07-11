import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementWorkbench } from '../RequirementWorkbench';
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
      within(screen.getByRole('complementary')).getByRole('button', {
        name: '登记合同 V1',
      }),
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
});
