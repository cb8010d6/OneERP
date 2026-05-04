import { EventQueueService } from './event-queue.service';

type MockPrisma = {
  eventDlq: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
  };
};

describe('EventQueueService', () => {
  const prisma: MockPrisma = {
    eventDlq: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const eventEmitter = {
    emitAsync: jest.fn(),
  };

  let service: EventQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EventQueueService(
      prisma as unknown as ConstructorParameters<typeof EventQueueService>[0],
      eventEmitter as unknown as ConstructorParameters<
        typeof EventQueueService
      >[1],
    );
  });

  it('marks item as resolved when event publish succeeds', async () => {
    prisma.eventDlq.findMany.mockResolvedValue([
      {
        id: 'e1',
        eventName: 'order.created',
        payload: { orderId: 'o1' },
        error: '',
        attempts: 0,
        maxAttempts: 5,
        status: 'PENDING',
      },
    ]);

    prisma.eventDlq.updateMany.mockResolvedValue({ count: 1 });
    eventEmitter.emitAsync.mockResolvedValue(undefined);

    const result: {
      total: number;
      results: Array<{ id: string; status: string; error?: string }>;
    } = await service.retryPending(10);

    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual({ id: 'e1', status: 'RESOLVED' });
    expect(prisma.eventDlq.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: { status: 'RESOLVED' },
      }),
    );
  });

  it('keeps item pending with next retry when publish fails and attempts remain', async () => {
    prisma.eventDlq.findMany.mockResolvedValue([
      {
        id: 'e2',
        eventName: 'order.created',
        payload: { orderId: 'o2' },
        error: '',
        attempts: 1,
        maxAttempts: 5,
        status: 'PENDING',
      },
    ]);

    prisma.eventDlq.updateMany.mockResolvedValue({ count: 1 });
    eventEmitter.emitAsync.mockRejectedValue(new Error('boom'));
    prisma.eventDlq.findUnique.mockResolvedValue({
      id: 'e2',
      attempts: 2,
      maxAttempts: 5,
    });

    const result: {
      total: number;
      results: Array<{ id: string; status: string; error?: string }>;
    } = await service.retryPending(10);

    expect(result.total).toBe(1);
    expect(result.results[0].id).toBe('e2');
    expect(result.results[0].status).toBe('PENDING');
    expect(result.results[0].error).toBe('boom');
    expect(prisma.eventDlq.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e2' },
        data: {
          status: 'PENDING',
          error: 'boom',
        },
      }),
    );
  });
});
