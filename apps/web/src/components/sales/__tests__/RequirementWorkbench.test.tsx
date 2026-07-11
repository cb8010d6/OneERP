import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementWorkbench } from '../RequirementWorkbench';

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
});
