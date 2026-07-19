import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BankStatementService } from './bank-statement.service';

function createService() {
  const prisma = {
    bankStatementLine: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    supplierPayment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const service = new BankStatementService(prisma as never);
  return { service, prisma };
}

describe('BankStatementService', () => {
  describe('importBankStatementLines', () => {
    it('imports valid lines and skips duplicates', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' });
      prisma.bankStatementLine.create.mockResolvedValue({ id: 'new1' });

      const result = await service.importBankStatementLines('c1', {
        lines: [
          {
            transactionDate: '2026-01-15',
            amount: 1000,
            externalRef: 'REF-001',
          },
          {
            transactionDate: '2026-01-16',
            amount: -500,
            externalRef: 'REF-002',
          },
        ],
      });

      expect(result.total).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('throws when lines array is empty', async () => {
      const { service } = createService();

      await expect(
        service.importBankStatementLines('c1', { lines: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when amount is zero', async () => {
      const { service } = createService();

      await expect(
        service.importBankStatementLines('c1', {
          lines: [{ transactionDate: '2026-01-15', amount: 0 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getBankStatementLines', () => {
    it('returns lines with match candidates for unmatched', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findMany.mockResolvedValue([
        {
          id: 'line1',
          amount: 1000,
          status: 'UNMATCHED',
          transactionDate: new Date('2026-01-15'),
          payment: null,
          supplierPayment: null,
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 1000,
          paymentDate: new Date('2026-01-15'),
          partner: { id: 'p1', name: '客户A' },
        },
      ]);

      const result = await service.getBankStatementLines('c1');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].matchCandidates).toHaveLength(1);
      expect(result.rows[0].matchCandidates[0].targetType).toBe(
        'CUSTOMER_PAYMENT',
      );
    });
  });

  describe('matchBankStatementLine', () => {
    it('matches to customer payment when amount is positive', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findFirst.mockResolvedValue({
        id: 'line1',
        amount: 1000,
        status: 'UNMATCHED',
      });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        amount: 1000,
        postingStatus: 'POSTED',
      });
      prisma.bankStatementLine.update.mockResolvedValue({ id: 'line1' });

      await service.matchBankStatementLine('c1', 'line1', {
        targetType: 'CUSTOMER_PAYMENT',
        targetId: 'pay1',
      });

      expect(prisma.bankStatementLine.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'MATCHED',
            paymentId: 'pay1',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('throws when line is already matched', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findFirst.mockResolvedValue({
        id: 'line1',
        status: 'MATCHED',
      });

      await expect(
        service.matchBankStatementLine('c1', 'line1', {
          targetType: 'CUSTOMER_PAYMENT',
          targetId: 'pay1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when payment not found', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findFirst.mockResolvedValue({
        id: 'line1',
        amount: 1000,
        status: 'UNMATCHED',
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.matchBankStatementLine('c1', 'line1', {
          targetType: 'CUSTOMER_PAYMENT',
          targetId: 'pay1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('autoMatchBankStatementLines', () => {
    it('matches lines with exactly one candidate', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findMany.mockResolvedValue([
        {
          id: 'line1',
          amount: 1000,
          transactionDate: new Date('2026-01-15'),
          status: 'UNMATCHED',
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 1000,
          paymentDate: new Date('2026-01-15'),
          partner: { id: 'p1', name: '客户A' },
        },
      ]);
      prisma.bankStatementLine.findFirst.mockResolvedValue({
        id: 'line1',
        amount: 1000,
        status: 'UNMATCHED',
      });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        amount: 1000,
        postingStatus: 'POSTED',
      });
      prisma.bankStatementLine.update.mockResolvedValue({ id: 'line1' });

      const result = await service.autoMatchBankStatementLines('c1');

      expect(result.matched).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('skips lines with zero or multiple candidates', async () => {
      const { service, prisma } = createService();
      prisma.bankStatementLine.findMany.mockResolvedValue([
        {
          id: 'line1',
          amount: 999,
          transactionDate: new Date('2026-01-15'),
          status: 'UNMATCHED',
        },
      ]);
      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.autoMatchBankStatementLines('c1');

      expect(result.matched).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });
});
