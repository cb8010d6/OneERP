import { BadRequestException } from '@nestjs/common';
import { CustomerStatementService } from './customer-statement.service';

function createService() {
  const prisma = {
    partner: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    invoice: {
      findMany: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
    },
    creditNote: {
      findMany: jest.fn(),
    },
    customerRefund: {
      findMany: jest.fn(),
    },
  };
  const service = new CustomerStatementService(prisma as never);
  return { service, prisma };
}

describe('CustomerStatementService', () => {
  describe('listCustomerOptions', () => {
    it('returns active customers for company', async () => {
      const { service, prisma } = createService();
      const mockCustomers = [
        { id: 'c1', code: 'CUS-001', name: '客户A', type: 'CUSTOMER' },
      ];
      prisma.partner.findMany.mockResolvedValue(mockCustomers);

      const result = await service.listCustomerOptions('c1');

      expect(result).toEqual(mockCustomers);
      expect(prisma.partner.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'c1',
          isActive: true,
          type: { in: ['CUSTOMER', 'BOTH'] },
        },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
        },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        take: 500,
      });
    });
  });

  describe('getCustomerStatement', () => {
    it('returns statement with posted invoices and payments', async () => {
      const { service, prisma } = createService();
      prisma.partner.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-001',
          amount: 1000,
          issuedDate: new Date('2026-01-15'),
          order: {
            orderNo: 'ORD-001',
            partner: { id: 'p1', code: 'CUS-001', name: '客户A' },
          },
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 500,
          paymentDate: new Date('2026-01-20'),
          method: 'BANK_TRANSFER',
          partner: { id: 'p1', code: 'CUS-001', name: '客户A' },
        },
      ]);
      prisma.creditNote.findMany.mockResolvedValue([]);
      prisma.customerRefund.findMany.mockResolvedValue([]);

      const result = await service.getCustomerStatement('c1');

      expect(result.partners).toHaveLength(1);
      expect(result.partners[0].partnerId).toBe('p1');
      expect(result.partners[0].periodDebit).toBe(1000);
      expect(result.partners[0].periodCredit).toBe(500);
      expect(result.partners[0].endingBalance).toBe(500);
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(500);
    });

    it('throws when startDate is after endDate', async () => {
      const { service } = createService();

      await expect(
        service.getCustomerStatement('c1', '2026-06-01', '2026-01-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when partner is inactive', async () => {
      const { service, prisma } = createService();
      prisma.partner.findFirst.mockResolvedValue(null);

      await expect(
        service.getCustomerStatement('c1', undefined, undefined, 'p99'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns empty partners when no data', async () => {
      const { service, prisma } = createService();
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.creditNote.findMany.mockResolvedValue([]);
      prisma.customerRefund.findMany.mockResolvedValue([]);

      const result = await service.getCustomerStatement('c1');

      expect(result.partners).toHaveLength(0);
      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
    });
  });
});
