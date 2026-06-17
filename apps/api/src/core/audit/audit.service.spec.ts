import { AuditService } from './audit.service';

function createService() {
  const prisma = {
    auditLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const eventQueueService = {
    enqueue: jest.fn(),
  };
  const service = new AuditService(prisma as never, eventQueueService as never);
  return { service, prisma, eventQueueService };
}

describe('AuditService', () => {
  it('lists audit logs scoped by company, action, and entity', async () => {
    const { service, prisma } = createService();
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'BULK_POST_PURCHASE_INVOICES',
        entity: 'PurchaseInvoice',
        entityId: null,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        user: { id: 'u1', name: '财务', email: 'finance@example.com' },
        details: { total: 3, posted: 2, failed: 1, skipped: 0 },
      },
    ]);

    const result = await service.listActionLogs(
      'c1',
      'BULK_POST_PURCHASE_INVOICES',
      {
        entity: 'PurchaseInvoice',
        limit: 5,
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-30T23:59:59.999Z',
        userId: 'u1',
        status: 'FAILED',
      },
    );

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'c1',
        action: 'BULK_POST_PURCHASE_INVOICES',
        entity: 'PurchaseInvoice',
        userId: 'u1',
        createdAt: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lte: new Date('2026-06-30T23:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 5,
    });
    expect(result).toEqual({
      action: 'BULK_POST_PURCHASE_INVOICES',
      events: [
        {
          id: 'log-1',
          action: 'BULK_POST_PURCHASE_INVOICES',
          entity: 'PurchaseInvoice',
          entityId: null,
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          user: { id: 'u1', name: '财务', email: 'finance@example.com' },
          details: { total: 3, posted: 2, failed: 1, skipped: 0 },
        },
      ],
    });
  });

  it('clamps action log query limit', async () => {
    const { service, prisma } = createService();
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.listActionLogs('c1', 'BULK_POST_PURCHASE_INVOICES', {
      limit: 500,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('enqueues to DLQ with idempotencyKey when audit log creation fails', async () => {
    const { service, prisma, eventQueueService } = createService();
    prisma.auditLog.create.mockRejectedValue(new Error('DB down'));

    await service.logCrudAction({
      modelName: 'order',
      recordId: 'order-1',
      companyId: 'c1',
      userId: 'u1',
      action: 'CRUD_CREATE',
      after: { status: 'PENDING' },
    });

    expect(eventQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'audit.log.failed',
        idempotencyKey: 'audit:c1:u1:order:order-1:CRUD_CREATE',
        companyId: 'c1',
        maxAttempts: 3,
      }),
    );
  });
});
