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
  const ordersService = {
    createOrder: jest.fn(),
  };
  const service = new AIService(
    prisma as never,
    crudService as never,
    metadataService as never,
    workflowService as never,
    llmAdapterService as never,
    ordersService as never,
  );
  return {
    service,
    prisma,
    crudService,
    metadataService,
    workflowService,
    llmAdapterService,
    ordersService,
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

  it('routes AI order creation through OrdersService', async () => {
    const { service, llmAdapterService, crudService, ordersService } =
      createService();
    llmAdapterService.resolveToolCall.mockResolvedValue({
      toolName: 'create_resource',
      args: {
        modelName: 'order',
        data: {
          partnerId: 'partner-1',
          items: [{ productId: 'product-1', quantity: 2 }],
        },
      },
    });
    ordersService.createOrder.mockResolvedValue({
      id: 'order-1',
      orderNo: 'ORD-001',
      status: 'DRAFT',
    });

    const preview = (await service.command('创建订单', 'company-1', 'user-1', {
      dryRun: true,
    })) as { draft: { previewToken: string } };

    await service.command('创建订单', 'company-1', 'user-1', {
      dryRun: false,
      confirmation: { token: preview.draft.previewToken },
    });

    expect(crudService.create).not.toHaveBeenCalledWith(
      'order',
      expect.anything(),
      expect.anything(),
    );
    expect(ordersService.createOrder).toHaveBeenCalledWith(
      'company-1',
      'user-1',
      expect.objectContaining({
        partnerId: 'partner-1',
        items: [{ productId: 'product-1', quantity: 2 }],
      }),
    );
  });

  it('exposes only the AI workflow safety whitelist', async () => {
    const { service } = createService();
    const schemas = await service.getToolSchemas();
    const transition = schemas.find(
      (schema) => schema.name === 'transition_workflow',
    );
    const properties = transition?.parameters.properties as
      | {
          modelName?: { enum?: string[] };
          action?: { enum?: string[] };
        }
      | undefined;

    expect(properties?.modelName?.enum).toEqual(['order']);
    expect(properties?.action?.enum).toEqual([
      'submit',
      'start_production',
      'complete',
    ]);
    expect(transition?.description).toContain('销售发货工作台');
  });

  it('rejects AI shipment before creating a confirmation draft', async () => {
    const { service, llmAdapterService, workflowService } = createService();
    llmAdapterService.resolveToolCall.mockResolvedValue({
      toolName: 'transition_workflow',
      args: { modelName: 'order', recordId: 'order-1', action: 'ship' },
    });

    await expect(
      service.command('发货订单 ORD-001', 'company-1', 'user-1', {
        dryRun: true,
      }),
    ).rejects.toThrow('销售发货必须在订单详情的销售发货工作台执行');
    expect(workflowService.transition).not.toHaveBeenCalled();
  });

  it('rejects direct AI shipment execution before workflow transition', async () => {
    const { service, llmAdapterService, workflowService } = createService();
    llmAdapterService.resolveToolCall.mockResolvedValue({
      toolName: 'transition_workflow',
      args: { modelName: 'order', recordId: 'order-1', action: 'ship' },
    });

    await expect(
      service.command('发货订单 ORD-001', 'company-1', 'user-1', {
        dryRun: false,
      }),
    ).rejects.toThrow('销售发货必须在订单详情的销售发货工作台执行');
    expect(workflowService.transition).not.toHaveBeenCalled();
  });

  it.each([
    {
      modelName: 'workOrder',
      action: 'complete',
      message: '生产工单状态必须通过生产报工工作台更新',
    },
    {
      modelName: 'invoice',
      action: 'post',
      message: '发票过账必须通过财务工作台执行',
    },
    {
      modelName: 'order',
      action: 'cancel',
      message: '该工作流动作不在 AI 安全白名单中',
    },
  ])(
    'rejects $modelName $action outside the AI workflow whitelist',
    async ({ modelName, action, message }) => {
      const { service, llmAdapterService, workflowService } = createService();
      llmAdapterService.resolveToolCall.mockResolvedValue({
        toolName: 'transition_workflow',
        args: { modelName, recordId: 'record-1', action },
      });

      await expect(
        service.command('执行工作流', 'company-1', 'user-1', {
          dryRun: true,
        }),
      ).rejects.toThrow(message);
      expect(workflowService.transition).not.toHaveBeenCalled();
    },
  );

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
      rowCount: number;
      elapsedMs: number;
    };

    expect(result.explanation.summary).toContain('1 行');
    expect(result.explanation.filters).toContain('已按当前公司 companyId 过滤');
    expect(result.export.content).toContain('"status","count"');
    expect(result.export.content).toContain('"DRAFT","2"');
    expect(result.rowCount).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects SQL with dangerous keywords', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select * from "Order" where "companyId" = $1; drop table "Order"',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '检测到不安全 SQL 关键字',
    );
  });

  it('rejects SQL without companyId filter', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue('select * from "Order"');

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '查询必须包含 companyId 过滤',
    );
  });

  it('rejects multi-statement injection', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select * from "Order" where "companyId" = $1; delete from "Order"',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '检测到不安全 SQL 关键字',
    );
  });

  it('rejects non-SELECT statements', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'update "Order" set status = \'CLOSED\' where "companyId" = $1',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '只允许 SELECT 查询',
    );
  });

  it('enforces row limit when SQL has no LIMIT clause', async () => {
    const { service, prisma, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "id", "status" from "Order" where "companyId" = $1',
    );
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    await service.chat2sql('test', 'c1');

    const calls = prisma.$queryRawUnsafe.mock.calls as Array<[string, string]>;
    const calledSql = calls[0]?.[0];
    expect(calledSql).toContain('LIMIT 500');
  });

  it('preserves existing LIMIT clause', async () => {
    const { service, prisma, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "id" from "Order" where "companyId" = $1 limit 10',
    );
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    await service.chat2sql('test', 'c1');

    const calls = prisma.$queryRawUnsafe.mock.calls as Array<[string, string]>;
    const calledSql = calls[0]?.[0];
    expect(calledSql).toContain('limit 10');
    expect(calledSql).not.toContain('LIMIT 500');
  });

  it('rejects UNION queries', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "id" from "Order" where "companyId" = $1 union select "id" from "User" where "companyId" = $1',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '检测到不安全 SQL 关键字',
    );
  });

  it('rejects LIMIT above the enforced row cap', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "id" from "Order" where "companyId" = $1 limit 100000',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '查询 LIMIT 不能超过 500',
    );
  });

  it('rejects unsupported LIMIT syntax', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select "id" from "Order" where "companyId" = $1 limit all',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '查询 LIMIT 语法不受支持',
    );
  });

  it('rejects pg_sleep injection', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'select pg_sleep(60), * from "Order" where "companyId" = $1',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '检测到不安全 SQL 关键字',
    );
  });

  it('rejects explain/analyze probing', async () => {
    const { service, llmAdapterService } = createService();
    llmAdapterService.resolveReadSql.mockResolvedValue(
      'explain select * from "Order" where "companyId" = $1',
    );

    await expect(service.chat2sql('test', 'c1')).rejects.toThrow(
      '只允许 SELECT 查询',
    );
  });
});
