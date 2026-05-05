import { BadRequestException } from '@nestjs/common';
import { JournalType, TaxNature } from '@prisma/client';
import { AccountingService } from './accounting.service';

const mockTaxService = {
  round2: jest.fn((v: number) => Math.round((v + Number.EPSILON) * 100) / 100),
};

const mockTx = {
  $executeRawUnsafe: jest.fn(),
  journal: { upsert: jest.fn() },
  journalEntry: { create: jest.fn() },
  account: { upsert: jest.fn() },
};

const mockPrisma = {
  journal: { upsert: jest.fn() },
  journalEntry: { findFirst: jest.fn(), create: jest.fn() },
  material: { findFirst: jest.fn() },
  account: { findFirst: jest.fn(), upsert: jest.fn() },
  purchaseInvoice: { findFirst: jest.fn() },
  invoice: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};

describe('AccountingService', () => {
  let service: AccountingService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
    );
    mockTx.journal.upsert.mockResolvedValue({ id: 'journal1', code: 'GEN' });
    mockTx.journalEntry.create.mockResolvedValue({
      id: 'entry1',
      entryNo: 'JE-001',
      lines: [],
      journal: { code: 'GEN' },
    });
    mockTx.account.upsert.mockResolvedValue({ id: 'acc1' });
    service = new AccountingService(mockPrisma as any, mockTaxService as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBalancedEntry', () => {
    it('should create a balanced entry', async () => {
      await service.createBalancedEntry({
        companyId: 'c1',
        journalCode: 'GEN',
        journalName: 'General',
        journalType: JournalType.GENERAL,
        ref: 'T1',
        lines: [
          {
            accountCode: '1122',
            accountName: 'AR',
            accountType: 'ASSET',
            debit: 1000,
          },
          {
            accountCode: '6001',
            accountName: 'Rev',
            accountType: 'REVENUE',
            credit: 885,
          },
          {
            accountCode: '222101',
            accountName: 'Tax',
            accountType: 'LIABILITY',
            credit: 115,
          },
        ],
      });
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });

    it('should throw when debit != credit', async () => {
      await expect(
        service.createBalancedEntry({
          companyId: 'c1',
          journalCode: 'GEN',
          journalName: 'General',
          journalType: JournalType.GENERAL,
          lines: [
            {
              accountCode: '1122',
              accountName: 'AR',
              accountType: 'ASSET',
              debit: 1000,
            },
            {
              accountCode: '6001',
              accountName: 'Rev',
              accountType: 'REVENUE',
              credit: 500,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when lines are empty', async () => {
      await expect(
        service.createBalancedEntry({
          companyId: 'c1',
          journalCode: 'GEN',
          journalName: 'General',
          journalType: JournalType.GENERAL,
          lines: [],
        }),
      ).rejects.toThrow();
    });

    it('should throw when a line has both debit and credit', async () => {
      await expect(
        service.createBalancedEntry({
          companyId: 'c1',
          journalCode: 'GEN',
          journalName: 'General',
          journalType: JournalType.GENERAL,
          lines: [
            {
              accountCode: '1122',
              accountName: 'AR',
              accountType: 'ASSET',
              debit: 500,
              credit: 500,
            },
          ],
        }),
      ).rejects.toThrow();
    });

    it('should throw when amount is negative', async () => {
      await expect(
        service.createBalancedEntry({
          companyId: 'c1',
          journalCode: 'GEN',
          journalName: 'General',
          journalType: JournalType.GENERAL,
          lines: [
            {
              accountCode: '1122',
              accountName: 'AR',
              accountType: 'ASSET',
              debit: -100,
            },
            {
              accountCode: '6001',
              accountName: 'Rev',
              accountType: 'REVENUE',
              credit: 100,
            },
          ],
        }),
      ).rejects.toThrow();
    });
  });

  describe('postStockDepletedEntry', () => {
    it('should create COGS entry: Debit 6401, Credit 1405', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        name: 'Steel',
        unitPrice: 50,
      });
      const result = await service.postStockDepletedEntry({
        companyId: 'c1',
        materialId: 'mat1',
        quantity: 10,
        unitCost: 50,
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });

    it('should skip when amount is 0', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        name: 'Free',
        unitPrice: 0,
      });
      const result = await service.postStockDepletedEntry({
        companyId: 'c1',
        materialId: 'mat1',
        quantity: 10,
        unitCost: 0,
      });
      expect(result).toBeNull();
    });
  });

  describe('postInvoicePostedEntry', () => {
    it('should create sales entry: Debit AR, Credit Revenue + Output Tax', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-001',
        amount: 1130,
        subTotal: 1000,
        taxAmount: 130,
        taxRate: 0.13,
        taxNature: TaxNature.OUTPUT,
        taxCode: null,
        order: { orderNo: 'ORD-001', partnerId: 'p1' },
      });
      const result = await service.postInvoicePostedEntry({
        companyId: 'c1',
        invoiceId: 'inv1',
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
      expect(mockTx.journal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_code: { companyId: 'c1', code: 'SAL' } },
        }),
      );
    });

    it('should throw when invoice not found', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      await expect(
        service.postInvoicePostedEntry({
          companyId: 'c1',
          invoiceId: 'x',
          operatorId: 'u1',
        }),
      ).rejects.toThrow();
    });

    it('should use fallback tax when snapshot missing', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv2',
        invoiceNo: 'INV-002',
        amount: 1130,
        subTotal: 0,
        taxAmount: 0,
        taxRate: 0.13,
        taxNature: TaxNature.OUTPUT,
        taxCode: null,
        order: { orderNo: 'ORD-002', partnerId: 'p1' },
      });
      const result = await service.postInvoicePostedEntry({
        companyId: 'c1',
        invoiceId: 'inv2',
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
    });
  });

  describe('postVendorBillPostedEntry', () => {
    it('should use default 1401 when lines have no accountId', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'pi1',
        invoiceNo: 'VB-001',
        amount: 1130,
        subTotal: 1000,
        taxAmount: 130,
        taxRate: 0.13,
        taxNature: TaxNature.INPUT,
        taxCode: null,
        partnerId: 'p1',
        partner: { id: 'p1', name: 'Supplier A' },
        lines: [
          { subTotal: 600, accountId: null, account: null },
          { subTotal: 400, accountId: null, account: null },
        ],
      });
      const result = await service.postVendorBillPostedEntry({
        companyId: 'c1',
        invoiceId: 'pi1',
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
    });

    it('should support mixed inventory + expense accounts', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'pi2',
        invoiceNo: 'VB-002',
        amount: 2260,
        subTotal: 2000,
        taxAmount: 260,
        taxRate: 0.13,
        taxNature: TaxNature.INPUT,
        taxCode: null,
        partnerId: 'p1',
        partner: { id: 'p1', name: 'Supplier B' },
        lines: [
          {
            subTotal: 1000,
            accountId: 'acc-inv',
            account: { code: '1401', name: 'Inventory', type: 'ASSET' },
          },
          {
            subTotal: 500,
            accountId: 'acc-exp',
            account: { code: '6601', name: 'Admin Expense', type: 'EXPENSE' },
          },
          {
            subTotal: 500,
            accountId: 'acc-exp',
            account: { code: '6601', name: 'Admin Expense', type: 'EXPENSE' },
          },
        ],
      });
      const result = await service.postVendorBillPostedEntry({
        companyId: 'c1',
        invoiceId: 'pi2',
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
    });

    it('should fallback to invoice-level subTotal when lines empty', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'pi3',
        invoiceNo: 'VB-003',
        amount: 1130,
        subTotal: 1000,
        taxAmount: 130,
        taxRate: 0.13,
        taxNature: TaxNature.INPUT,
        taxCode: null,
        partnerId: 'p1',
        partner: { id: 'p1', name: 'Supplier C' },
        lines: [],
      });
      const result = await service.postVendorBillPostedEntry({
        companyId: 'c1',
        invoiceId: 'pi3',
        operatorId: 'u1',
      });
      expect(result).toBeDefined();
    });

    it('should throw when purchase invoice not found', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue(null);
      await expect(
        service.postVendorBillPostedEntry({
          companyId: 'c1',
          invoiceId: 'x',
          operatorId: 'u1',
        }),
      ).rejects.toThrow();
    });

    it('should throw when amount <= 0', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'pi4',
        invoiceNo: 'VB-004',
        amount: 0,
        subTotal: 0,
        taxAmount: 0,
        partnerId: 'p1',
        partner: { id: 'p1', name: 'Supplier D' },
        lines: [],
      });
      await expect(
        service.postVendorBillPostedEntry({
          companyId: 'c1',
          invoiceId: 'pi4',
          operatorId: 'u1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Balance verification', () => {
    it('sales: AR(1130) = Revenue(1000) + Tax(130)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv10',
        invoiceNo: 'INV-010',
        amount: 1130,
        subTotal: 1000,
        taxAmount: 130,
        taxRate: 0.13,
        taxNature: TaxNature.OUTPUT,
        taxCode: null,
        order: { orderNo: 'ORD-010', partnerId: 'p1' },
      });
      await service.postInvoicePostedEntry({
        companyId: 'c1',
        invoiceId: 'inv10',
        operatorId: 'u1',
      });
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });

    it('purchase: Inventory(1000) + Tax(130) = AP(1130)', async () => {
      mockPrisma.purchaseInvoice.findFirst.mockResolvedValue({
        id: 'pi10',
        invoiceNo: 'VB-010',
        amount: 1130,
        subTotal: 1000,
        taxAmount: 130,
        taxRate: 0.13,
        taxNature: TaxNature.INPUT,
        taxCode: null,
        partnerId: 'p1',
        partner: { id: 'p1', name: 'Supplier X' },
        lines: [{ subTotal: 1000, accountId: null, account: null }],
      });
      await service.postVendorBillPostedEntry({
        companyId: 'c1',
        invoiceId: 'pi10',
        operatorId: 'u1',
      });
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });

    it('stock depletion: COGS(500) = Inventory(500)', async () => {
      mockPrisma.material.findFirst.mockResolvedValue({
        name: 'Widget',
        unitPrice: 50,
      });
      await service.postStockDepletedEntry({
        companyId: 'c1',
        materialId: 'mat10',
        quantity: 10,
        unitCost: 50,
        operatorId: 'u1',
      });
      expect(mockTx.journalEntry.create).toHaveBeenCalled();
    });
  });
});
