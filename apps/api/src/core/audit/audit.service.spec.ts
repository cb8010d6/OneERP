import { AuditService } from './audit.service';

function createService() {
  const prisma = {
    auditLog: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const service = new AuditService(prisma as never);
  return { service, prisma };
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
});
