import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineeringDocumentWorkbench } from '../EngineeringDocumentWorkbench';
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
  AsyncSelect: ({ id, onChange }: { id: string; onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange(id.includes('product') ? 'product-1' : 'order-1')}>
      {id.includes('product') ? '选择产品' : '选择订单'}
    </button>
  ),
}));

describe('EngineeringDocumentWorkbench', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      token: 'token',
      user: { id: 'designer-1' },
      companies: [
        {
          id: 'company-1',
          name: '测试公司',
          role: 'EngineeringDesign',
          permissions: [
            'engineeringDocument:read',
            'engineeringDocument:create',
            'fileRecord:create',
          ],
        },
      ],
      currentCompanyId: 'company-1',
    });
    mockGet.mockResolvedValue({ data: [] });
    mockPost
      .mockResolvedValueOnce({ data: { id: 'file-1', checksumSha256: 'abc' } })
      .mockResolvedValueOnce({ data: { id: 'document-1' } });
  });

  it('uploads a file and creates a linked engineering document', async () => {
    const user = userEvent.setup();
    render(<EngineeringDocumentWorkbench />);

    await user.click(screen.getByText('新建工程文档'));
    await user.type(screen.getByLabelText('文档标题'), '总装图');
    await user.click(screen.getByText('选择产品'));
    await user.upload(
      screen.getByLabelText('版本文件'),
      new File(['drawing'], 'assembly.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByText('创建草稿版本'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/engineering-documents',
        expect.objectContaining({
          title: '总装图',
          productId: 'product-1',
          fileRecordId: 'file-1',
        }),
      );
    });
  });

  it('reviews a pending revision from the workbench', async () => {
    useAuthStore.setState({
      companies: [
        {
          id: 'company-1',
          name: '测试公司',
          role: 'EngineeringReview',
          permissions: [
            'engineeringDocument:read',
            'engineeringDocument:review',
          ],
        },
      ],
    });
    mockGet.mockResolvedValue({
      data: [
        {
          id: 'document-1',
          documentNo: 'ED-P1001-000001',
          title: '总装图',
          documentType: 'DRAWING',
          currentRevisionNo: 1,
          currentReleasedRevisionId: null,
          updatedAt: '2026-07-12T00:00:00.000Z',
          product: { id: 'product-1', sku: 'P-1001', name: '设备' },
          order: null,
          revisions: [
            {
              id: 'revision-1',
              revisionNo: 1,
              status: 'PENDING_REVIEW',
              checksumSha256: 'a'.repeat(64),
              createdAt: '2026-07-12T00:00:00.000Z',
              fileRecord: {
                id: 'file-1',
                fileName: 'assembly.pdf',
                objectKey: 'company-1/engineering/assembly.pdf',
              },
              creator: { id: 'designer-1', name: '设计员' },
              reviewer: null,
              approver: null,
            },
          ],
        },
      ],
    });
    mockPost.mockResolvedValue({ data: { status: 'PENDING_APPROVAL' } });
    const user = userEvent.setup();
    render(<EngineeringDocumentWorkbench />);

    expect(await screen.findByText('开始校审')).toBeInTheDocument();
    await user.click(screen.getByText('开始校审'));
    await user.type(screen.getByLabelText('校审意见'), '尺寸和材料符合要求');
    await user.click(screen.getByText('校审通过'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/engineering-documents/revisions/revision-1/review',
        {
          decision: 'APPROVE',
          comment: '尺寸和材料符合要求',
        },
      );
    });
  });
});
