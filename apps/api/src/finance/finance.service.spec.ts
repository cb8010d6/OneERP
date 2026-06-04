import { NotFoundException } from '@nestjs/common';
import { FinanceService } from './finance.service';

type MockPrisma = {
  order: { findFirst: jest.Mock };
  partner: { findFirst: jest.Mock };
  taxCode: { findFirst: jest.Mock };
  invoice: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  payment: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  paymentAllocation: { create: jest.Mock };
  creditNote: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  customerRefund: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  inventoryReturnDocument: { findFirst: jest.Mock };
  materialCost: { findMany: jest.Mock };
  journalEntryLine: { findMany: jest.Mock };
  eventDlq: { findMany: jest.Mock };
  purchaseInvoice: { findMany: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

type MockTx = {
  payment: { create: jest.Mock };
  paymentAllocation: { create: jest.Mock };
  invoice: { update: jest.Mock };
  creditNote: { update: jest.Mock };
};

describe('FinanceService', () => {
  const prisma: MockPrisma = {
    order: { findFirst: jest.fn() },
    partner: { findFirst: jest.fn() },
    taxCode: { findFirst: jest.fn() },
    invoice: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    payment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    paymentAllocation: { create: jest.fn() },
    creditNote: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    customerRefund: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    inventoryReturnDocument: { findFirst: jest.fn() },
    materialCost: { findMany: jest.fn() },
    journalEntryLine: { findMany: jest.fn() },
    eventDlq: { findMany: jest.fn() },
    purchaseInvoice: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    payment: { create: jest.fn() },
    paymentAllocation: { create: jest.fn() },
    invoice: { update: jest.fn() },
    creditNote: { update: jest.fn() },
  };

  const eventEmitter = { emit: jest.fn() };
  const financeAccountMappingService = {
    resolveLineAccount: jest.fn(),
  };

  let service: FinanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: (trx: MockTx) => unknown) =>
      cb(tx),
    );
    financeAccountMappingService.resolveLineAccount.mockResolvedValue({
      accountCode: '1405',
      accountName: '库存商品',
      accountType: 'ASSET',
    });
    service = new FinanceService(
      prisma as unknown as ConstructorParameters<typeof FinanceService>[0],
      eventEmitter as unknown as ConstructorParameters<
        typeof FinanceService
      >[1],
      financeAccountMappingService as unknown as ConstructorParameters<
        typeof FinanceService
      >[2],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reconciles inventory valuation with inventory general ledger balance', async () => {
    prisma.materialCost.findMany.mockResolvedValue([
      {
        materialId: 'm1',
        quantityOnHand: 5,
        averageCost: 12,
        inventoryValue: 60,
        material: { id: 'm1', sku: 'MAT-1', name: '钢板' },
      },
      {
        materialId: 'm2',
        quantityOnHand: 2,
        averageCost: 20,
        inventoryValue: 40,
        material: { id: 'm2', sku: 'MAT-2', name: '管材' },
      },
    ]);
    prisma.journalEntryLine.findMany
      .mockResolvedValueOnce([
        { debit: 80, credit: 0 },
        { debit: 30, credit: 10 },
      ])
      .mockResolvedValueOnce([
        {
          journalEntryId: 'je-1',
          debit: 30,
          credit: 10,
          memo: '采购入库',
          journalEntry: {
            entryNo: 'JE-001',
            date: new Date('2026-06-01T00:00:00.000Z'),
            ref: 'PI-001',
            description: '采购发票过账',
          },
        },
      ]);
    prisma.eventDlq.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        eventName: 'purchase.invoice.posted',
        status: 'FAILED',
        attempts: 5,
        maxAttempts: 5,
        nextRetryAt: null,
        updatedAt: new Date('2026-06-02T00:00:00.000Z'),
        error: '科目映射缺失',
      },
    ]);
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      {
        id: 'pi-2',
        invoiceNo: 'PI-002',
        purchaseOrderId: 'po-2',
        amount: 128,
        subTotal: 100,
        taxAmount: 28,
        issuedDate: new Date('2026-06-03T00:00:00.000Z'),
        postingStatus: 'DRAFT',
        purchaseOrder: {
          purchaseNo: 'PO-002',
          items: [{ quantity: 2, receivedQty: 2, unitPrice: 50 }],
          invoices: [{ amount: 128, subTotal: 100, taxAmount: 28 }],
        },
        supplier: { name: '测试供应商' },
      },
      {
        id: 'pi-3',
        invoiceNo: 'PI-003',
        purchaseOrderId: 'po-3',
        amount: 80,
        subTotal: 80,
        taxAmount: 0,
        issuedDate: new Date('2026-06-04T00:00:00.000Z'),
        postingStatus: 'DRAFT',
        purchaseOrder: {
          purchaseNo: 'PO-003',
          items: [{ quantity: 2, receivedQty: 1, unitPrice: 40 }],
          invoices: [{ amount: 80, subTotal: 80, taxAmount: 0 }],
        },
        supplier: { name: '阻塞供应商' },
      },
    ]);

    const result = await service.getInventoryValuationReconciliation('c1');

    expect(
      financeAccountMappingService.resolveLineAccount,
    ).toHaveBeenCalledWith('c1', 'INVENTORY');
    expect(result).toEqual(
      expect.objectContaining({
        inventoryValue: 100,
        generalLedgerBalance: 100,
        difference: 0,
        reconciled: true,
        materialCount: 2,
      }),
    );
    expect(result.diagnostics).toEqual({
      recentGeneralLedgerLines: [
        {
          journalEntryId: 'je-1',
          entryNo: 'JE-001',
          date: '2026-06-01T00:00:00.000Z',
          ref: 'PI-001',
          description: '采购发票过账',
          memo: '采购入库',
          debit: 30,
          credit: 10,
          balance: 20,
        },
      ],
      pendingEvents: [
        {
          id: 'ev-1',
          eventName: 'purchase.invoice.posted',
          status: 'FAILED',
          attempts: 5,
          maxAttempts: 5,
          nextRetryAt: null,
          updatedAt: '2026-06-02T00:00:00.000Z',
          error: '科目映射缺失',
        },
      ],
      unpostedPurchaseInvoices: [
        {
          id: 'pi-2',
          invoiceNo: 'PI-002',
          purchaseOrderId: 'po-2',
          purchaseNo: 'PO-002',
          supplierName: '测试供应商',
          issuedDate: '2026-06-03T00:00:00.000Z',
          amount: 128,
          postingStatus: 'DRAFT',
          matchStatus: 'MATCHED',
          isPostable: true,
          matchReasons: [],
          amountVariance: 0,
        },
        {
          id: 'pi-3',
          invoiceNo: 'PI-003',
          purchaseOrderId: 'po-3',
          purchaseNo: 'PO-003',
          supplierName: '阻塞供应商',
          issuedDate: '2026-06-04T00:00:00.000Z',
          amount: 80,
          postingStatus: 'DRAFT',
          matchStatus: 'PARTIAL_RECEIPT',
          isPostable: false,
          matchReasons: ['存在未收足明细', '采购价差 40.00 将自动入账'],
          amountVariance: 40,
        },
      ],
    });
  });

  describe('createInvoice', () => {
    it('should create an invoice when order exists', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', companyId: 'c1' });
      prisma.invoice.create.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-123',
        orderId: 'o1',
        amount: 1000,
        status: 'UNPAID',
        companyId: 'c1',
      });
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.createInvoice(
        'c1',
        {
          orderId: 'o1',
          amount: 1000,
          dueDate: '2025-12-31',
        },
        'u1',
      );

      expect(result.id).toBe('inv1');
      expect(prisma.invoice.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createInvoice(
          'c1',
          { orderId: 'x', amount: 100, dueDate: '2025-01-01' },
          'u1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getInvoices', () => {
    it('should return paginated invoices', async () => {
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv1', amount: 1000 }]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await service.getInvoices('c1', { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('recordPayment', () => {
    it('should record payment and update invoice to PAID', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        amount: 1000,
        status: 'UNPAID',
        postingStatus: 'POSTED',
        order: { partnerId: 'p1' },
        paymentAllocations: [],
      });
      tx.payment.create.mockResolvedValue({
        id: 'pay1',
        invoiceId: 'inv1',
        amount: 1000,
      });
      tx.invoice.update.mockResolvedValue({});

      const result = await service.recordPayment(
        'c1',
        'inv1',
        {
          amount: 1000,
          method: 'BANK_TRANSFER',
        },
        'u1',
      );

      expect(result.id).toBe('pay1');
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          invoiceId: 'inv1',
          partnerId: 'p1',
          amount: 1000,
          method: 'BANK_TRANSFER',
          companyId: 'c1',
          postingStatus: 'DRAFT',
        },
      });
      expect(tx.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'pay1',
          invoiceId: 'inv1',
          amount: 1000,
          companyId: 'c1',
        },
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PAID' },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.payment.recorded',
        expect.objectContaining({
          companyId: 'c1',
          paymentId: 'pay1',
          operatorId: 'u1',
        }),
      );
    });

    it('should set PARTIAL status for partial payment', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        amount: 1000,
        status: 'UNPAID',
        postingStatus: 'POSTED',
        order: { partnerId: 'p1' },
        paymentAllocations: [],
      });
      tx.payment.create.mockResolvedValue({ id: 'pay2', amount: 500 });
      tx.invoice.update.mockResolvedValue({});

      await service.recordPayment('c1', 'inv1', {
        amount: 500,
        method: 'ALIPAY',
      });

      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PARTIAL' },
      });
    });

    it('should reject payment before invoice is posted', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        amount: 1000,
        status: 'UNPAID',
        postingStatus: 'DRAFT',
        order: { partnerId: 'p1' },
        paymentAllocations: [],
      });

      await expect(
        service.recordPayment('c1', 'inv1', {
          amount: 100,
          method: 'BANK_TRANSFER',
        }),
      ).rejects.toThrow('发票尚未过账');
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('should reject overpayment', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        amount: 1000,
        status: 'PARTIAL',
        postingStatus: 'POSTED',
        order: { partnerId: 'p1' },
        paymentAllocations: [{ amount: 800 }],
      });

      await expect(
        service.recordPayment('c1', 'inv1', {
          amount: 250,
          method: 'BANK_TRANSFER',
        }),
      ).rejects.toThrow('收款金额超过发票剩余应收');
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when invoice missing', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.recordPayment('c1', 'x', { amount: 100, method: 'ALIPAY' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordReceivablePayment', () => {
    it('should allocate one customer payment to multiple posted invoices', async () => {
      prisma.partner.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-1',
          amount: 1000,
          status: 'UNPAID',
          postingStatus: 'POSTED',
          order: { partnerId: 'p1' },
          paymentAllocations: [],
        },
        {
          id: 'inv2',
          invoiceNo: 'INV-2',
          amount: 800,
          status: 'UNPAID',
          postingStatus: 'POSTED',
          order: { partnerId: 'p1' },
          paymentAllocations: [{ amount: 100 }],
        },
      ]);
      tx.payment.create.mockResolvedValue({ id: 'pay3', amount: 1500 });
      tx.paymentAllocation.create.mockResolvedValue({});
      tx.invoice.update.mockResolvedValue({});

      const result = await service.recordReceivablePayment(
        'c1',
        {
          partnerId: 'p1',
          amount: 1500,
          method: 'BANK_TRANSFER',
          allocations: [
            { invoiceId: 'inv1', amount: 1000 },
            { invoiceId: 'inv2', amount: 500 },
          ],
        },
        'u1',
      );

      expect(result.id).toBe('pay3');
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          invoiceId: 'inv1',
          partnerId: 'p1',
          amount: 1500,
          method: 'BANK_TRANSFER',
          companyId: 'c1',
          postingStatus: 'DRAFT',
        },
      });
      expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(2);
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PAID' },
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv2' },
        data: { status: 'PARTIAL' },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.payment.recorded',
        expect.objectContaining({ paymentId: 'pay3', operatorId: 'u1' }),
      );
    });

    it('should reject allocations across different customers', async () => {
      prisma.partner.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-1',
          amount: 1000,
          status: 'UNPAID',
          postingStatus: 'POSTED',
          order: { partnerId: 'other' },
          paymentAllocations: [],
        },
      ]);

      await expect(
        service.recordReceivablePayment('c1', {
          partnerId: 'p1',
          amount: 100,
          method: 'BANK_TRANSFER',
          allocations: [{ invoiceId: 'inv1', amount: 100 }],
        }),
      ).rejects.toThrow('只能核销同一客户');
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('should allow a payment amount greater than allocated invoices', async () => {
      prisma.partner.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-1',
          amount: 1000,
          status: 'UNPAID',
          postingStatus: 'POSTED',
          order: { partnerId: 'p1' },
          paymentAllocations: [],
        },
      ]);
      tx.payment.create.mockResolvedValue({ id: 'pay4', amount: 700 });
      tx.paymentAllocation.create.mockResolvedValue({});
      tx.invoice.update.mockResolvedValue({});

      await service.recordReceivablePayment('c1', {
        partnerId: 'p1',
        amount: 700,
        method: 'BANK_TRANSFER',
        allocations: [{ invoiceId: 'inv1', amount: 500 }],
      });

      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          invoiceId: 'inv1',
          partnerId: 'p1',
          amount: 700,
          method: 'BANK_TRANSFER',
          companyId: 'c1',
          postingStatus: 'DRAFT',
        },
      });
      expect(tx.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'pay4',
          invoiceId: 'inv1',
          amount: 500,
          companyId: 'c1',
        },
      });
    });
  });

  describe('postInvoice', () => {
    it('should post an invoice and emit event', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-123',
        postingStatus: 'DRAFT',
        amount: 1000,
        subTotal: 0,
        taxAmount: 0,
        taxCodeId: null,
        order: { taxCodeId: null },
      });
      prisma.invoice.update.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-123',
        postingStatus: 'POSTED',
      });
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.postInvoice(
        'c1',
        'inv1',
        'u1',
        undefined,
        0.13,
      );

      expect(result.postingStatus).toBe('POSTED');
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: expect.objectContaining({ postingStatus: 'POSTED' }) as unknown,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.invoice.posted',
        expect.objectContaining({
          companyId: 'c1',
          invoiceId: 'inv1',
          taxCodeId: null,
          taxRate: 0.13,
        }),
      );
    });

    it('should skip posting when already POSTED', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-123',
        postingStatus: 'POSTED',
      });

      const result = await service.postInvoice('c1', 'inv1', 'u1');

      expect((result as { message?: string }).message).toContain('已过账');
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when invoice not found', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.postInvoice('c1', 'nonexistent', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getReceivableAging', () => {
    it('should bucket posted open receivables by due date', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-1',
          amount: 1000,
          issuedDate: new Date('2026-04-01T00:00:00.000Z'),
          dueDate: new Date('2026-05-20T00:00:00.000Z'),
          paymentAllocations: [{ amount: 200 }],
          order: {
            orderNo: 'SO-1',
            partner: { id: 'p1', name: '蓝海科技' },
          },
        },
        {
          id: 'inv2',
          invoiceNo: 'INV-2',
          amount: 300,
          issuedDate: new Date('2026-05-01T00:00:00.000Z'),
          dueDate: new Date('2026-06-10T00:00:00.000Z'),
          paymentAllocations: [],
          order: {
            orderNo: 'SO-2',
            partner: { id: 'p2', name: '星河制造' },
          },
        },
      ]);

      const result = await service.getReceivableAging('c1', '2026-05-31');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'c1',
            postingStatus: 'POSTED',
            status: { not: 'PAID' },
          },
        }),
      );
      expect(result.totalOpen).toBe(1100);
      expect(result.days1To30).toBe(800);
      expect(result.current).toBe(300);
      expect(result.rows[0]).toEqual(
        expect.objectContaining({
          invoiceNo: 'INV-1',
          partnerName: '蓝海科技',
          openAmount: 800,
          daysOverdue: 11,
          bucket: 'DAYS_1_30',
        }),
      );
    });
  });

  describe('getUnappliedPayments', () => {
    it('should return only payments with unapplied balances', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          amount: 700,
          paymentDate: new Date('2026-06-01T00:00:00.000Z'),
          method: 'BANK_TRANSFER',
          postingStatus: 'POSTED',
          partner: { id: 'p1', name: '蓝海科技' },
          allocations: [{ amount: 500 }],
        },
        {
          id: 'pay2',
          amount: 300,
          paymentDate: new Date('2026-06-01T00:00:00.000Z'),
          method: 'ALIPAY',
          postingStatus: 'POSTED',
          partner: { id: 'p2', name: '星河制造' },
          allocations: [{ amount: 300 }],
        },
      ]);

      const result = await service.getUnappliedPayments('c1');

      expect(result.rows).toEqual([
        expect.objectContaining({
          paymentId: 'pay1',
          partnerName: '蓝海科技',
          amount: 700,
          allocatedAmount: 500,
          unappliedAmount: 200,
        }),
      ]);
    });
  });

  describe('applyReceivablePayment', () => {
    it('should apply an existing unapplied payment to posted invoices', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        partnerId: 'p1',
        amount: 700,
        allocations: [{ amount: 200 }],
      });
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'INV-1',
          amount: 1000,
          status: 'UNPAID',
          postingStatus: 'POSTED',
          order: { partnerId: 'p1' },
          paymentAllocations: [{ amount: 300 }],
        },
      ]);
      tx.paymentAllocation.create.mockResolvedValue({ id: 'pa1' });
      tx.invoice.update.mockResolvedValue({});

      const result = await service.applyReceivablePayment(
        'c1',
        'pay1',
        { allocations: [{ invoiceId: 'inv1', amount: 400 }] },
        'u1',
      );

      expect(result).toEqual({
        paymentId: 'pay1',
        allocationIds: ['pa1'],
        allocatedAmount: 400,
      });
      expect(tx.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'pay1',
          invoiceId: 'inv1',
          amount: 400,
          companyId: 'c1',
        },
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PARTIAL' },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.payment.applied',
        expect.objectContaining({
          paymentId: 'pay1',
          allocationIds: ['pa1'],
          operatorId: 'u1',
        }),
      );
    });

    it('should reject allocations beyond unapplied balance', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay1',
        partnerId: 'p1',
        amount: 700,
        allocations: [{ amount: 650 }],
      });

      await expect(
        service.applyReceivablePayment('c1', 'pay1', {
          allocations: [{ invoiceId: 'inv1', amount: 100 }],
        }),
      ).rejects.toThrow('核销金额超过未分配收款余额');
      expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
    });
  });

  describe('creditNotes', () => {
    it('should create a draft credit note against a posted open invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-1',
        amount: 1000,
        taxCodeId: null,
        postingStatus: 'POSTED',
        order: { partnerId: 'p1', taxCodeId: null },
        paymentAllocations: [{ amount: 200 }],
        creditNotes: [],
      });
      prisma.creditNote.create.mockResolvedValue({
        id: 'cn1',
        creditNo: 'CN-1',
        amount: 300,
        postingStatus: 'DRAFT',
      });
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.createCreditNote(
        'c1',
        {
          invoiceId: 'inv1',
          amount: 300,
          reason: '客户退货',
        },
        'u1',
      );

      expect(result.id).toBe('cn1');
      expect(prisma.creditNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceId: 'inv1',
          partnerId: 'p1',
          amount: 300,
          status: 'DRAFT',
          postingStatus: 'DRAFT',
          reason: '客户退货',
        }) as unknown,
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATE_CREDIT_NOTE',
          entityId: 'cn1',
        }) as unknown,
      });
    });

    it('should allow a credit note on a fully paid invoice as refund liability', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-1',
        amount: 1000,
        taxCodeId: null,
        postingStatus: 'POSTED',
        order: { partnerId: 'p1', taxCodeId: null },
        paymentAllocations: [{ amount: 1000 }],
        creditNotes: [],
      });
      prisma.creditNote.create.mockResolvedValue({
        id: 'cn-paid',
        amount: 200,
        postingStatus: 'DRAFT',
      });
      prisma.auditLog.create.mockResolvedValue({});

      await service.createCreditNote(
        'c1',
        { invoiceId: 'inv1', amount: 200 },
        'u1',
      );

      expect(prisma.creditNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceId: 'inv1',
          partnerId: 'p1',
          amount: 200,
        }) as unknown,
      });
    });

    it('should link a sales return document when creating a credit note', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-1',
        orderId: 'o1',
        amount: 1000,
        taxCodeId: null,
        postingStatus: 'POSTED',
        order: {
          id: 'o1',
          orderNo: 'SO-001',
          partnerId: 'p1',
          taxCodeId: null,
        },
        paymentAllocations: [],
        creditNotes: [],
      });
      prisma.inventoryReturnDocument.findFirst.mockResolvedValue({
        id: 'ret1',
        returnNo: 'SR-001',
        returnType: 'SALES',
        sourceDocumentId: 'o1',
        sourceDocumentNo: 'SO-001',
        status: 'POSTED',
        creditNote: null,
      });
      prisma.creditNote.create.mockResolvedValue({
        id: 'cn-ret',
        amount: 300,
        postingStatus: 'DRAFT',
      });
      prisma.auditLog.create.mockResolvedValue({});

      await service.createCreditNote(
        'c1',
        {
          invoiceId: 'inv1',
          amount: 300,
          inventoryReturnDocumentId: 'ret1',
        },
        'u1',
      );

      expect(prisma.inventoryReturnDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'ret1', companyId: 'c1' },
        include: {
          creditNote: { select: { id: true, creditNo: true } },
        },
      });
      expect(prisma.creditNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          invoiceId: 'inv1',
          inventoryReturnDocumentId: 'ret1',
        }) as unknown,
      });
    });

    it('should reject a return document from a different sales order', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        invoiceNo: 'INV-1',
        orderId: 'o1',
        amount: 1000,
        taxCodeId: null,
        postingStatus: 'POSTED',
        order: {
          id: 'o1',
          orderNo: 'SO-001',
          partnerId: 'p1',
          taxCodeId: null,
        },
        paymentAllocations: [],
        creditNotes: [],
      });
      prisma.inventoryReturnDocument.findFirst.mockResolvedValue({
        id: 'ret2',
        returnNo: 'SR-002',
        returnType: 'SALES',
        sourceDocumentId: 'other-order',
        sourceDocumentNo: 'SO-999',
        status: 'POSTED',
        creditNote: null,
      });

      await expect(
        service.createCreditNote(
          'c1',
          {
            invoiceId: 'inv1',
            amount: 300,
            inventoryReturnDocumentId: 'ret2',
          },
          'u1',
        ),
      ).rejects.toThrow('退货单与原发票销售订单不匹配');
      expect(prisma.creditNote.create).not.toHaveBeenCalled();
    });

    it('should reject credit notes above the remaining creditable invoice amount', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        amount: 1000,
        taxCodeId: null,
        postingStatus: 'POSTED',
        order: { partnerId: 'p1', taxCodeId: null },
        paymentAllocations: [{ amount: 800 }],
        creditNotes: [{ amount: 100, postingStatus: 'POSTED' }],
      });

      await expect(
        service.createCreditNote(
          'c1',
          { invoiceId: 'inv1', amount: 950 },
          'u1',
        ),
      ).rejects.toThrow('贷项金额超过发票可冲减金额');
      expect(prisma.creditNote.create).not.toHaveBeenCalled();
    });

    it('should post a credit note and update invoice settlement status', async () => {
      prisma.creditNote.findFirst.mockResolvedValue({
        id: 'cn1',
        creditNo: 'CN-1',
        invoiceId: 'inv1',
        amount: 300,
        postingStatus: 'DRAFT',
        invoice: {
          id: 'inv1',
          amount: 1000,
          postingStatus: 'POSTED',
          paymentAllocations: [{ amount: 700 }],
          creditNotes: [],
        },
      });
      tx.creditNote.update.mockResolvedValue({
        id: 'cn1',
        postingStatus: 'POSTED',
      });
      tx.invoice.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.postCreditNote('c1', 'cn1', 'u1');

      expect(result.postingStatus).toBe('POSTED');
      expect(tx.creditNote.update).toHaveBeenCalledWith({
        where: { id: 'cn1' },
        data: expect.objectContaining({
          status: 'POSTED',
          postingStatus: 'POSTED',
          receivableAppliedAmount: 300,
          refundLiabilityAmount: 0,
        }) as unknown,
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PAID' },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.credit_note.posted',
        expect.objectContaining({
          companyId: 'c1',
          creditNoteId: 'cn1',
          operatorId: 'u1',
        }),
      );
    });

    it('should split posted credit note into receivable and refund liability', async () => {
      prisma.creditNote.findFirst.mockResolvedValue({
        id: 'cn2',
        creditNo: 'CN-2',
        invoiceId: 'inv1',
        amount: 300,
        postingStatus: 'DRAFT',
        invoice: {
          id: 'inv1',
          amount: 1000,
          postingStatus: 'POSTED',
          paymentAllocations: [{ amount: 800 }],
          creditNotes: [],
        },
      });
      tx.creditNote.update.mockResolvedValue({
        id: 'cn2',
        postingStatus: 'POSTED',
      });
      tx.invoice.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.postCreditNote('c1', 'cn2', 'u1');

      expect(tx.creditNote.update).toHaveBeenCalledWith({
        where: { id: 'cn2' },
        data: expect.objectContaining({
          receivableAppliedAmount: 200,
          refundLiabilityAmount: 100,
        }) as unknown,
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PAID' },
      });
    });

    it('should create and post a customer refund from refund liability', async () => {
      prisma.creditNote.findFirst.mockResolvedValue({
        id: 'cn2',
        partnerId: 'p1',
        refundLiabilityAmount: 100,
        postingStatus: 'POSTED',
        refunds: [{ amount: 40, postingStatus: 'POSTED' }],
      });
      prisma.customerRefund.create.mockResolvedValue({
        id: 'rf1',
        refundNo: 'RF-1',
        amount: 60,
        postingStatus: 'DRAFT',
      });
      prisma.auditLog.create.mockResolvedValue({});

      await service.createCustomerRefund(
        'c1',
        {
          creditNoteId: 'cn2',
          amount: 60,
          method: 'BANK_TRANSFER',
        },
        'u1',
      );

      expect(prisma.customerRefund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          creditNoteId: 'cn2',
          partnerId: 'p1',
          amount: 60,
          method: 'BANK_TRANSFER',
          postingStatus: 'DRAFT',
        }) as unknown,
      });

      prisma.customerRefund.findFirst.mockResolvedValue({
        id: 'rf1',
        refundNo: 'RF-1',
        amount: 60,
        method: 'BANK_TRANSFER',
        postingStatus: 'DRAFT',
        creditNoteId: 'cn2',
        creditNote: {
          refundLiabilityAmount: 100,
          postingStatus: 'POSTED',
          refunds: [{ amount: 40, postingStatus: 'POSTED' }],
        },
      });
      prisma.customerRefund.update.mockResolvedValue({
        id: 'rf1',
        postingStatus: 'POSTED',
      });

      const result = await service.postCustomerRefund('c1', 'rf1', 'u1');

      expect(result.postingStatus).toBe('POSTED');
      expect(prisma.customerRefund.update).toHaveBeenCalledWith({
        where: { id: 'rf1' },
        data: expect.objectContaining({
          status: 'POSTED',
          postingStatus: 'POSTED',
        }) as unknown,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'finance.customer_refund.posted',
        expect.objectContaining({
          refundId: 'rf1',
          operatorId: 'u1',
        }),
      );
    });
  });
});
