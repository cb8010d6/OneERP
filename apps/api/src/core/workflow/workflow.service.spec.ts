import { WorkflowService } from './workflow.service';

describe('WorkflowService', () => {
  const workflow = {
    id: 'wf-1',
    transitions: [
      {
        action: 'submit',
        fromState: { id: 's0', value: 'DRAFT', label: '草稿', sort: 0 },
        toState: { id: 's1', value: 'PENDING', label: '待处理', sort: 1 },
        label: '提交',
      },
      {
        action: 'ship',
        fromState: {
          id: 's1',
          value: 'IN_PRODUCTION',
          label: '生产中',
          sort: 1,
        },
        toState: { id: 's2', value: 'SHIPPED', label: '已发货', sort: 2 },
        label: '发货',
      },
      {
        action: 'cancel',
        fromState: { id: 's2', value: 'SHIPPED', label: '已发货', sort: 2 },
        toState: { id: 's3', value: 'CANCELLED', label: '已取消', sort: 3 },
        label: '取消',
      },
    ],
  };

  const tx = {
    order: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    workOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const prisma = {
    workflow: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const eventQueueService = {
    publish: jest.fn(),
  };

  let service: WorkflowService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.workflow.findFirst.mockResolvedValue(workflow);
    prisma.$transaction.mockImplementation(
      <T>(callback: (transaction: typeof tx) => Promise<T> | T) => callback(tx),
    );
    tx.order.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'DRAFT',
      orderNo: 'SO-1',
    });
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'PENDING',
      orderNo: 'SO-1',
    });
    tx.workOrder.findFirst.mockResolvedValue({
      id: 'work-order-1',
      status: 'IN_PROGRESS',
    });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'invoice-1',
      status: 'UNPAID',
    });
    tx.auditLog.create.mockResolvedValue({});
    eventQueueService.publish.mockResolvedValue({ id: 'event-1' });

    service = new WorkflowService(
      prisma as unknown as ConstructorParameters<typeof WorkflowService>[0],
      eventQueueService as unknown as ConstructorParameters<
        typeof WorkflowService
      >[1],
    );
  });

  it('queues workflow action events with idempotency keys after transition', async () => {
    const result = await service.transition(
      'order',
      'order-1',
      'submit',
      'company-1',
      'user-1',
      'submit order',
    );

    expect(result).toEqual({
      modelName: 'order',
      recordId: 'order-1',
      action: 'submit',
      from: 'DRAFT',
      to: 'PENDING',
      data: {
        id: 'order-1',
        status: 'PENDING',
        orderNo: 'SO-1',
      },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'DRAFT' },
      data: { status: 'PENDING' },
    });
    expect(eventQueueService.publish).toHaveBeenCalledTimes(2);
    expect(eventQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.action.sale_order.pending',
        idempotencyKey: 'workflow.action.sale_order.pending:order-1',
        companyId: 'company-1',
        payload: expect.objectContaining({
          modelName: 'order',
          eventModel: 'sale_order',
          recordId: 'order-1',
          companyId: 'company-1',
          action: 'submit',
          from: 'DRAFT',
          to: 'PENDING',
        }) as unknown,
      }),
    );
  });

  it('rejects generic sales shipment before changing order state', async () => {
    tx.order.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'IN_PRODUCTION',
    });

    await expect(
      service.transition('order', 'order-1', 'ship', 'company-1', 'user-1'),
    ).rejects.toThrow('销售发货必须通过销售发货工作台执行');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cancellation while shipped inventory is still posted', async () => {
    tx.order.findFirst.mockResolvedValue({ id: 'order-1', status: 'SHIPPED' });

    await expect(
      service.transition('order', 'order-1', 'cancel', 'company-1', 'user-1'),
    ).rejects.toThrow('取消前必须先通过库存冲销或销售退货恢复库存');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'workOrder',
      'work-order-1',
      'complete',
      '生产工单状态必须通过生产报工工作台更新',
    ],
    ['invoice', 'invoice-1', 'post', '发票状态必须通过财务工作台更新'],
  ])(
    'rejects specialized %s state changes through generic workflow',
    async (modelName, recordId, action, message) => {
      await expect(
        service.transition(modelName, recordId, action, 'company-1', 'user-1'),
      ).rejects.toThrow(message);
      expect(tx.workOrder.updateMany).not.toHaveBeenCalled();
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    },
  );
});
