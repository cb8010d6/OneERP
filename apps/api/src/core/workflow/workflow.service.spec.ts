import { WorkflowService } from './workflow.service';

describe('WorkflowService', () => {
  const workflow = {
    id: 'wf-1',
    transitions: [
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
      status: 'IN_PRODUCTION',
      orderNo: 'SO-1',
    });
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'SHIPPED',
      orderNo: 'SO-1',
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
      'ship',
      'company-1',
      'user-1',
      'ship now',
      { sourceLocationId: 'loc-1' },
    );

    expect(result).toEqual({
      modelName: 'order',
      recordId: 'order-1',
      action: 'ship',
      from: 'IN_PRODUCTION',
      to: 'SHIPPED',
      data: {
        id: 'order-1',
        status: 'SHIPPED',
        orderNo: 'SO-1',
      },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'IN_PRODUCTION' },
      data: { status: 'SHIPPED' },
    });
    expect(eventQueueService.publish).toHaveBeenCalledTimes(1);
    expect(eventQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.action.sale_order.shipped',
        idempotencyKey: 'workflow.action.sale_order.shipped:order-1',
        companyId: 'company-1',
        payload: expect.objectContaining({
          modelName: 'order',
          eventModel: 'sale_order',
          recordId: 'order-1',
          companyId: 'company-1',
          action: 'ship',
          from: 'IN_PRODUCTION',
          to: 'SHIPPED',
        }) as unknown,
      }),
    );
  });
});
