import { EventQueueService } from './event-queue.service';

type MockPrisma = {
  eventDlq: {
    create: jest.Mock;
    findFirst: jest.Mock;
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
      findFirst: jest.fn(),
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

    type UpdateCall = {
      where: { id: string };
      data: { status: string; error: string; nextRetryAt: null };
    };

    const updateCalls = prisma.eventDlq.update.mock.calls as unknown as Array<
      [UpdateCall]
    >;
    const updateCall = updateCalls[0]?.[0];

    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual({ id: 'e1', status: 'RESOLVED' });
    expect(updateCall.where).toEqual({ id: 'e1' });
    expect(updateCall.data.status).toBe('RESOLVED');
    expect(updateCall.data.error).toBe('');
    expect(updateCall.data.nextRetryAt).toBeNull();
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

    type UpdateCall = {
      where: { id: string };
      data: {
        status: string;
        error: string;
        nextRetryAt: Date | null;
      };
    };

    const updateCalls = prisma.eventDlq.update.mock.calls as unknown as Array<
      [UpdateCall]
    >;
    const updateCall = updateCalls[0]?.[0];

    expect(result.total).toBe(1);
    expect(result.results[0].id).toBe('e2');
    expect(result.results[0].status).toBe('PENDING');
    expect(result.results[0].error).toBe('boom');
    expect(updateCall.where).toEqual({ id: 'e2' });
    expect(updateCall.data.status).toBe('PENDING');
    expect(updateCall.data.error).toBe('boom');
    expect(updateCall.data.nextRetryAt).toBeInstanceOf(Date);
  });

  describe('idempotency key deduplication', () => {
    it('enqueue returns null when a RESOLVED event with same idempotencyKey exists', async () => {
      prisma.eventDlq.findFirst.mockResolvedValue({ id: 'existing-id' });

      const result = await service.enqueue({
        eventName: 'order.created',
        idempotencyKey: 'order_created:abc-123',
        payload: { orderId: 'abc-123' },
      });

      expect(result).toBeNull();
      expect(prisma.eventDlq.create).not.toHaveBeenCalled();
    });

    it('enqueue creates event when no RESOLVED event with same idempotencyKey exists', async () => {
      prisma.eventDlq.findFirst.mockResolvedValue(null);
      prisma.eventDlq.create.mockResolvedValue({ id: 'new-id' });

      const result = await service.enqueue({
        eventName: 'order.created',
        idempotencyKey: 'order_created:abc-123',
        payload: { orderId: 'abc-123' },
      });

      expect(result).toEqual({ id: 'new-id' });
      expect(prisma.eventDlq.create).toHaveBeenCalled();
    });

    it('enqueue skips idempotency check when no idempotencyKey provided', async () => {
      prisma.eventDlq.create.mockResolvedValue({ id: 'new-id' });

      const result = await service.enqueue({
        eventName: 'order.created',
        payload: { orderId: 'abc-123' },
      });

      expect(result).toEqual({ id: 'new-id' });
      expect(prisma.eventDlq.findFirst).not.toHaveBeenCalled();
      expect(prisma.eventDlq.create).toHaveBeenCalled();
    });

    it('publish returns null when idempotencyKey already resolved', async () => {
      prisma.eventDlq.findFirst.mockResolvedValue({ id: 'existing-id' });

      const result = await service.publish({
        eventName: 'order.created',
        idempotencyKey: 'order_created:abc-123',
        payload: { orderId: 'abc-123' },
      });

      expect(result).toBeNull();
    });

    it('processItem skips when duplicate RESOLVED event with same idempotencyKey exists', async () => {
      prisma.eventDlq.findMany.mockResolvedValue([
        {
          id: 'e3',
          eventName: 'order.created',
          idempotencyKey: 'order_created:abc-123',
          payload: { orderId: 'abc-123' },
          error: '',
          attempts: 0,
          maxAttempts: 5,
          status: 'PENDING',
        },
      ]);

      prisma.eventDlq.findFirst.mockResolvedValue({ id: 'other-resolved-id' });
      prisma.eventDlq.update.mockResolvedValue({});

      const result = await service.retryPending(10);

      expect(result.total).toBe(1);
      expect(result.results[0]).toEqual({ id: 'e3', status: 'RESOLVED' });
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });
});
