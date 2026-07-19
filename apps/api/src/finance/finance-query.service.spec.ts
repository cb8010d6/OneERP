import { FinanceQueryService } from './finance-query.service';

function createService() {
  const prisma = {
    invoice: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
    },
    creditNote: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    customerRefund: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const service = new FinanceQueryService(prisma as never);
  return { service, prisma };
}

describe('FinanceQueryService', () => {
  describe('getInvoices', () => {
    it('returns paginated invoices', async () => {
      const { service, prisma } = createService();
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv1', amount: 1000 }]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await service.getInvoices('c1', { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('calculates correct skip for page 2', async () => {
      const { service, prisma } = createService();
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await service.getInvoices('c1', { page: 2, limit: 10 });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('getUnappliedPayments', () => {
    it('returns only payments with unapplied balance', async () => {
      const { service, prisma } = createService();
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 700,
          paymentDate: new Date('2026-06-01T00:00:00.000Z'),
          method: 'BANK_TRANSFER',
          postingStatus: 'POSTED',
          partner: { id: 'p1', name: '客户A' },
          allocations: [{ amount: 500 }],
        },
        {
          id: 'pay2',
          amount: 300,
          paymentDate: new Date('2026-06-01T00:00:00.000Z'),
          method: 'ALIPAY',
          postingStatus: 'POSTED',
          partner: { id: 'p2', name: '客户B' },
          allocations: [{ amount: 300 }],
        },
      ]);

      const result = await service.getUnappliedPayments('c1');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].paymentId).toBe('pay1');
      expect(result.rows[0].unappliedAmount).toBe(200);
    });

    it('sorts by unapplied amount descending', async () => {
      const { service, prisma } = createService();
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 100,
          paymentDate: new Date('2026-06-01'),
          method: 'CASH',
          postingStatus: 'POSTED',
          partner: { id: 'p1', name: 'A' },
          allocations: [],
        },
        {
          id: 'pay2',
          amount: 500,
          paymentDate: new Date('2026-06-01'),
          method: 'CASH',
          postingStatus: 'POSTED',
          partner: { id: 'p2', name: 'B' },
          allocations: [],
        },
      ]);

      const result = await service.getUnappliedPayments('c1');

      expect(result.rows[0].paymentId).toBe('pay2');
      expect(result.rows[1].paymentId).toBe('pay1');
    });
  });

  describe('getCreditNotes', () => {
    it('returns paginated credit notes', async () => {
      const { service, prisma } = createService();
      prisma.creditNote.findMany.mockResolvedValue([
        { id: 'cn1', creditNo: 'CN-001' },
      ]);
      prisma.creditNote.count.mockResolvedValue(1);

      const result = await service.getCreditNotes('c1', { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getCustomerRefunds', () => {
    it('returns paginated customer refunds', async () => {
      const { service, prisma } = createService();
      prisma.customerRefund.findMany.mockResolvedValue([
        { id: 'rf1', refundNo: 'RF-001' },
      ]);
      prisma.customerRefund.count.mockResolvedValue(1);

      const result = await service.getCustomerRefunds('c1', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });
});
