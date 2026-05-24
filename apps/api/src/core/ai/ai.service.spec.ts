import { AIService } from './ai.service';

function createService() {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
  };
  const crudService = {
    create: jest.fn(),
  };
  const metadataService = {
    listSchemas: jest.fn().mockResolvedValue([{ model: 'partner' }]),
  };
  const workflowService = {
    transition: jest.fn(),
  };
  const llmAdapterService = {
    resolveToolCall: jest.fn(),
    resolveReadSql: jest.fn(),
  };
  const service = new AIService(
    prisma as never,
    crudService as never,
    metadataService as never,
    workflowService as never,
    llmAdapterService as never,
  );
  return {
    service,
    prisma,
    crudService,
    metadataService,
    workflowService,
    llmAdapterService,
  };
}

describe('AIService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_WRITE_ENABLED = 'true';
    process.env.AI_PREVIEW_SECRET = 'test-preview-secret';
  });

  it('returns a signed sandbox preview token for write commands', async () => {
    const { service, llmAdapterService, crudService } = createService();
    llmAdapterService.resolveToolCall.mockResolvedValue({
      toolName: 'create_resource',
      args: { modelName: 'partner', data: { name: '客户A' } },
    });

    const result = (await service.command('创建客户A', 'c1', 'u1', {
      dryRun: true,
    })) as { type: string; draft: { previewToken?: string } };

    expect(result.type).toBe('draft');
    expect(result.draft.previewToken).toBeTruthy();
    expect(crudService.create).not.toHaveBeenCalled();
  });

  it('executes confirmed write command from signed preview token', async () => {
    const { service, llmAdapterService, crudService } = createService();
    llmAdapterService.resolveToolCall.mockResolvedValue({
      toolName: 'create_resource',
      args: { modelName: 'partner', data: { name: '客户A' } },
    });
    crudService.create.mockResolvedValue({ id: 'p1', name: '客户A' });

    const preview = (await service.command('创建客户A', 'c1', 'u1', {
      dryRun: true,
    })) as { draft: { previewToken: string } };

    await service.command('创建客户A', 'c1', 'u1', {
      dryRun: false,
      confirmation: { token: preview.draft.previewToken },
    });

    expect(crudService.create).toHaveBeenCalledWith(
      'partner',
      { name: '客户A' },
      'c1',
    );
  });

  it('rejects tampered preview token', async () => {
    const { service } = createService();

    await expect(
      service.command('创建客户A', 'c1', 'u1', {
        dryRun: false,
        confirmation: { token: 'bad.token' },
      }),
    ).rejects.toThrow('AI 草稿确认 token 无效');
  });

  it('returns Chat2SQL explanation and CSV export', async () => {
    const { service, prisma, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "status", count(*) as "count" from "Order" where "companyId" = $1 group by "status" limit 10',
    );
    prisma.$queryRawUnsafe.mockResolvedValue([{ status: 'DRAFT', count: 2 }]);

    const result = (await service.chat2sql('订单状态分布', 'c1')) as {
      explanation: { summary: string; filters: string[] };
      export: { content: string };
    };

    expect(result.explanation.summary).toContain('1 行');
    expect(result.explanation.filters).toContain('已按当前公司 companyId 过滤');
    expect(result.export.content).toContain('"status","count"');
    expect(result.export.content).toContain('"DRAFT","2"');
  });
});
