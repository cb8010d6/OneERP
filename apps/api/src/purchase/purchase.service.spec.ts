import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { SupplierStatementService } from './supplier-statement.service';
import { PurchaseQueryService } from './purchase-query.service';

function createService() {
  const tx = {
    purchaseReceipt: {
      create: jest.fn(),
    },
    purchaseOrderLine: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    purchaseOrder: {
      update: jest.fn(),
    },
    purchaseInvoice: {
      update: jest.fn(),
    },
    supplierCreditNote: {
      update: jest.fn(),
    },
    supplierPayment: {
      update: jest.fn(),
    },
  };
  const prisma = {
    partner: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    material: {
      count: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    purchaseInvoice: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    inventoryReturnDocument: {
      findFirst: jest.fn(),
    },
    supplierCreditNote: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    supplierPayment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const inventoryService = {
    postPurchaseInbound: jest.fn(),
    createStockMove: jest.fn(),
    createStockMoveInTransaction: jest.fn(),
  };
  const eventEmitter = {
    emit: jest.fn(),
  };
  const supplierStatementService = new SupplierStatementService(
    prisma as never,
  );
  const purchaseQueryService = new PurchaseQueryService(
    prisma as never,
  );
  const service = new PurchaseService(
    prisma as never,
    inventoryService as never,
    eventEmitter as never,
    supplierStatementService,
    purchaseQueryService,
  );
  return { service, prisma, tx, inventoryService, eventEmitter };
}

describe('PurchaseService', () => {
  it('creates purchase order totals from line quantities and prices', async () => {
    const { service, prisma } = createService();
    prisma.partner.findFirst.mockResolvedValue({ id: 'supplier-1' });
    prisma.material.count.mockResolvedValue(1);
    prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1' });

    await service.createPurchaseOrder('c1', 'u1', {
      supplierId: 'supplier-1',
      items: [{ materialId: 'm1', quantity: 3, unitPrice: 12.5 }],
    });

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: 'supplier-1',
          buyerId: 'u1',
          companyId: 'c1',
          status: 'ORDERED',
          subTotal: new Decimal(37.5),
          totalAmount: new Decimal(37.5),
        }) as unknown,
      }),
    );
  });

  it('receives purchase order and posts inventory inbound', async () => {
    const { service, prisma, tx, inventoryService } = createService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseNo: 'PO-001',
      status: 'ORDERED',
      items: [
        {
          id: 'line-1',
          materialId: 'm1',
          quantity: new Decimal(5),
          receivedQty: new Decimal(1),
          unitPrice: new Decimal(12),
        },
      ],
    });
    tx.purchaseReceipt.create.mockResolvedValue({
      id: 'gr-1',
      receiptNo: 'GR-001',
      lines: [
        {
          purchaseOrderLineId: 'line-1',
          materialId: 'm1',
          quantity: new Decimal(2),
          destLocationId: 'loc-1',
          batchNo: 'B1',
        },
      ],
    });
    tx.purchaseOrderLine.findMany.mockResolvedValue([
      { receivedQty: new Decimal(3), quantity: new Decimal(5) },
    ]);
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce({
        id: 'po-1',
        purchaseNo: 'PO-001',
        status: 'ORDERED',
        items: [
          {
            id: 'line-1',
            materialId: 'm1',
            quantity: new Decimal(5),
            receivedQty: new Decimal(1),
            unitPrice: new Decimal(12),
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'po-1', status: 'PARTIAL_RECEIVED' });

    const result = await service.receivePurchaseOrder('c1', 'u1', 'po-1', {
      lines: [
        {
          purchaseOrderLineId: 'line-1',
          quantity: 2,
          destLocationId: 'loc-1',
          batchNo: 'B1',
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'po-1', status: 'PARTIAL_RECEIVED' }),
    );
    expect(inventoryService.createStockMoveInTransaction).toHaveBeenCalledWith(
      tx,
      'c1',
      expect.objectContaining({
        materialId: 'm1',
        quantity: 2,
        destLocationId: 'loc-1',
        batchNo: 'B1',
        unitCost: 12,
        referenceNo: 'PURCHASE-IN-PO-001-GR-001',
        documentId: 'GR-001',
        documentType: 'PURCHASE_RECEIPT',
      }),
      'u1',
    );
  });

  it('rejects over-receiving purchase quantities', async () => {
    const { service, prisma } = createService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      status: 'ORDERED',
      items: [
        {
          id: 'line-1',
          quantity: new Decimal(5),
          receivedQty: new Decimal(4),
        },
      ],
    });

    await expect(
      service.receivePurchaseOrder('c1', 'u1', 'po-1', {
        lines: [{ purchaseOrderLineId: 'line-1', quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates payable invoice after receipt', async () => {
    const { service, prisma } = createService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      supplierId: 'supplier-1',
      status: 'RECEIVED',
      totalAmount: new Decimal(100),
      subTotal: new Decimal(100),
      taxTotal: new Decimal(0),
      invoices: [],
    });
    prisma.purchaseInvoice.create.mockResolvedValue({ id: 'pi-1' });

    await service.createPurchaseInvoice('c1', 'po-1', {
      invoiceNo: 'PINV-001',
    });

    expect(prisma.purchaseInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNo: 'PINV-001',
          purchaseOrderId: 'po-1',
          supplierId: 'supplier-1',
          companyId: 'c1',
          status: 'UNPAID',
        }) as unknown,
      }),
    );
  });

  it('posts payable invoice and emits accounting event', async () => {
    const { service, prisma, eventEmitter } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      invoiceNo: 'PI-001',
      postingStatus: 'DRAFT',
      purchaseOrder: {
        items: [
          {
            id: 'line-1',
            materialId: 'm1',
            quantity: new Decimal(2),
            receivedQty: new Decimal(2),
            unitPrice: new Decimal(50),
            material: { name: '钢板', sku: 'SP-1' },
          },
        ],
        invoices: [
          {
            id: 'pi-1',
            invoiceNo: 'PI-001',
            amount: new Decimal(100),
            subTotal: new Decimal(100),
            taxAmount: new Decimal(0),
          },
        ],
      },
    });
    prisma.purchaseInvoice.update.mockResolvedValue({
      id: 'pi-1',
      postingStatus: 'POSTED',
    });

    const result = await service.postPurchaseInvoice('c1', 'pi-1', 'u1');

    expect(result).toEqual({ id: 'pi-1', postingStatus: 'POSTED' });
    expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith({
      where: { id: 'pi-1' },
      data: { postingStatus: 'POSTED' },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith('purchase.invoice.posted', {
      companyId: 'c1',
      idempotencyKey: 'purchase_invoice_posted:pi-1',
      purchaseInvoiceId: 'pi-1',
      operatorId: 'u1',
    });
  });

  it('rejects payable invoice posting when receipt is short', async () => {
    const { service, prisma, eventEmitter } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      invoiceNo: 'PI-001',
      postingStatus: 'DRAFT',
      purchaseOrder: {
        items: [
          {
            id: 'line-1',
            materialId: 'm1',
            quantity: new Decimal(2),
            receivedQty: new Decimal(1),
            unitPrice: new Decimal(50),
            material: { name: '钢板', sku: 'SP-1' },
          },
        ],
        invoices: [
          {
            id: 'pi-1',
            invoiceNo: 'PI-001',
            amount: new Decimal(100),
            subTotal: new Decimal(100),
            taxAmount: new Decimal(0),
          },
        ],
      },
    });

    await expect(
      service.postPurchaseInvoice('c1', 'pi-1', 'u1'),
    ).rejects.toThrow('应付发票未通过三单匹配');
    expect(prisma.purchaseInvoice.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('allows payable invoice posting when only purchase price variance exists', async () => {
    const { service, prisma, eventEmitter } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      invoiceNo: 'PI-001',
      postingStatus: 'DRAFT',
      purchaseOrder: {
        items: [
          {
            id: 'line-1',
            materialId: 'm1',
            quantity: new Decimal(2),
            receivedQty: new Decimal(2),
            unitPrice: new Decimal(50),
            material: { name: '钢板', sku: 'SP-1' },
          },
        ],
        invoices: [
          {
            id: 'pi-1',
            invoiceNo: 'PI-001',
            amount: new Decimal(110),
            subTotal: new Decimal(110),
            taxAmount: new Decimal(0),
          },
        ],
      },
    });
    prisma.purchaseInvoice.update.mockResolvedValue({
      id: 'pi-1',
      postingStatus: 'POSTED',
    });

    const result = await service.postPurchaseInvoice('c1', 'pi-1', 'u1');

    expect(result).toEqual({ id: 'pi-1', postingStatus: 'POSTED' });
    expect(eventEmitter.emit).toHaveBeenCalledWith('purchase.invoice.posted', {
      companyId: 'c1',
      idempotencyKey: 'purchase_invoice_posted:pi-1',
      purchaseInvoiceId: 'pi-1',
      operatorId: 'u1',
    });
  });

  it('adds three-way match summary to listed purchase orders', async () => {
    const { service, prisma } = createService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po-1',
        purchaseNo: 'PO-001',
        items: [
          {
            id: 'line-1',
            materialId: 'm1',
            quantity: new Decimal(2),
            receivedQty: new Decimal(2),
            unitPrice: new Decimal(50),
            material: { name: '钢板', sku: 'SP-1' },
          },
        ],
        invoices: [
          {
            id: 'pi-1',
            invoiceNo: 'PI-001',
            amount: new Decimal(100),
            subTotal: new Decimal(100),
            taxAmount: new Decimal(0),
          },
        ],
      },
    ]);

    const result = await service.listPurchaseOrders('c1');

    expect(result[0]).toEqual(
      expect.objectContaining({
        purchaseMatch: expect.objectContaining({
          status: 'MATCHED',
          isPostable: true,
          receivedAmount: 100,
          invoicedAmount: 100,
          amountVariance: 0,
        }) as unknown,
      }),
    );
  });

  it('does not emit duplicate event for already posted payable invoice', async () => {
    const { service, prisma, eventEmitter } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      invoiceNo: 'PI-001',
      postingStatus: 'POSTED',
    });

    const result = await service.postPurchaseInvoice('c1', 'pi-1', 'u1');

    expect(result).toEqual(
      expect.objectContaining({
        purchaseInvoiceId: 'pi-1',
        postingStatus: 'POSTED',
      }),
    );
    expect(prisma.purchaseInvoice.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('bulk posts payable invoices and keeps per-invoice failure reasons', async () => {
    const { service, prisma } = createService();
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      { id: 'pi-1', invoiceNo: 'PI-1' },
      { id: 'pi-2', invoiceNo: 'PI-2' },
      { id: 'pi-3', invoiceNo: 'PI-3' },
    ]);
    const postSpy = jest
      .spyOn(service, 'postPurchaseInvoice')
      .mockResolvedValueOnce({
        id: 'pi-1',
        invoiceNo: 'PI-1',
        postingStatus: 'POSTED',
      } as never)
      .mockResolvedValueOnce({
        purchaseInvoiceId: 'pi-2',
        invoiceNo: 'PI-2',
        postingStatus: 'POSTED',
        message: '应付发票已过账，无需重复处理',
      } as never)
      .mockRejectedValueOnce(new BadRequestException('三单匹配未通过'));

    const result = await service.bulkPostPurchaseInvoices(
      'c1',
      ['pi-1', 'pi-2', 'pi-2', 'pi-3'],
      'u1',
    );

    expect(prisma.purchaseInvoice.findMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', id: { in: ['pi-1', 'pi-2', 'pi-3'] } },
      select: { id: true, invoiceNo: true },
    });
    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(postSpy).toHaveBeenNthCalledWith(1, 'c1', 'pi-1', 'u1');
    expect(postSpy).toHaveBeenNthCalledWith(2, 'c1', 'pi-2', 'u1');
    expect(postSpy).toHaveBeenNthCalledWith(3, 'c1', 'pi-3', 'u1');
    expect(result).toEqual({
      total: 3,
      posted: 1,
      failed: 1,
      skipped: 1,
      results: [
        {
          purchaseInvoiceId: 'pi-1',
          status: 'POSTED',
          invoiceNo: 'PI-1',
          message: undefined,
        },
        {
          purchaseInvoiceId: 'pi-2',
          status: 'SKIPPED',
          invoiceNo: 'PI-2',
          message: '应付发票已过账，无需重复处理',
        },
        {
          purchaseInvoiceId: 'pi-3',
          status: 'FAILED',
          invoiceNo: 'PI-3',
          error: '三单匹配未通过',
        },
      ],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'BULK_POST_PURCHASE_INVOICES',
        entity: 'PurchaseInvoice',
        entityId: null,
        companyId: 'c1',
        details: result,
      },
    });
  });

  it('rejects bulk payable invoice posting without invoice ids', async () => {
    const { service } = createService();

    await expect(
      service.bulkPostPurchaseInvoices('c1', [' ', ''], 'u1'),
    ).rejects.toThrow('请选择需要过账的应付发票');
  });

  it('creates supplier credit note linked to a purchase return document', async () => {
    const { service, prisma } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      invoiceNo: 'PI-001',
      supplierId: 'supplier-1',
      amount: new Decimal(1000),
      purchaseOrder: { id: 'po-1', purchaseNo: 'PO-001' },
      supplierCreditNotes: [
        { amount: new Decimal(100), postingStatus: 'POSTED' },
      ],
    });
    prisma.inventoryReturnDocument.findFirst.mockResolvedValue({
      id: 'ret-1',
      returnNo: 'PR-001',
      returnType: 'PURCHASE',
      sourceDocumentNo: 'PO-001',
      status: 'POSTED',
      supplierCreditNote: null,
    });
    prisma.supplierCreditNote.create.mockResolvedValue({ id: 'scn-1' });

    await service.createSupplierCreditNote('c1', 'pi-1', {
      amount: 200,
      inventoryReturnDocumentId: 'ret-1',
      reason: '采购退货扣款',
    });

    expect(prisma.inventoryReturnDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'ret-1', companyId: 'c1' },
      include: {
        supplierCreditNote: { select: { id: true, creditNo: true } },
      },
    });
    expect(prisma.supplierCreditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchaseInvoiceId: 'pi-1',
          supplierId: 'supplier-1',
          amount: new Decimal(200),
          inventoryReturnDocumentId: 'ret-1',
          reason: '采购退货扣款',
          status: 'DRAFT',
          postingStatus: 'DRAFT',
          companyId: 'c1',
        }) as unknown,
      }),
    );
  });

  it('lists active supplier options', async () => {
    const { service, prisma } = createService();
    prisma.partner.findMany.mockResolvedValue([
      { id: 'supplier-1', code: 'S001', name: '供应商A', type: 'SUPPLIER' },
    ]);

    const result = await service.listSupplierOptions('c1');

    expect(prisma.partner.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'c1',
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
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
    expect(result).toEqual([
      { id: 'supplier-1', code: 'S001', name: '供应商A', type: 'SUPPLIER' },
    ]);
  });

  it('builds a supplier statement with opening and running balances', async () => {
    const { service, prisma } = createService();
    prisma.partner.findFirst.mockResolvedValue({ id: 'supplier-1' });
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      {
        id: 'pi-opening',
        invoiceNo: 'PI-OPEN',
        issuedDate: new Date('2026-05-20T00:00:00.000Z'),
        amount: new Decimal(1000),
        supplier: { id: 'supplier-1', code: 'S001', name: '供应商A' },
        purchaseOrder: { purchaseNo: 'PO-OPEN' },
      },
      {
        id: 'pi-1',
        invoiceNo: 'PI-001',
        issuedDate: new Date('2026-06-05T00:00:00.000Z'),
        amount: new Decimal(600),
        supplier: { id: 'supplier-1', code: 'S001', name: '供应商A' },
        purchaseOrder: { purchaseNo: 'PO-001' },
      },
    ]);
    prisma.supplierPayment.findMany.mockResolvedValue([
      {
        id: 'sp-opening',
        paymentNo: 'SP-OPEN',
        paymentDate: new Date('2026-05-25T00:00:00.000Z'),
        amount: new Decimal(200),
        method: 'BANK_TRANSFER',
        note: null,
        supplier: { id: 'supplier-1', code: 'S001', name: '供应商A' },
      },
      {
        id: 'sp-1',
        paymentNo: 'SP-001',
        paymentDate: new Date('2026-06-10T00:00:00.000Z'),
        amount: new Decimal(300),
        method: 'BANK_TRANSFER',
        note: '月结付款',
        supplier: { id: 'supplier-1', code: 'S001', name: '供应商A' },
      },
    ]);
    prisma.supplierCreditNote.findMany.mockResolvedValue([
      {
        id: 'scn-1',
        creditNo: 'SCN-001',
        creditDate: new Date('2026-06-12T00:00:00.000Z'),
        amount: new Decimal(100),
        supplier: { id: 'supplier-1', code: 'S001', name: '供应商A' },
        purchaseInvoice: { invoiceNo: 'PI-001' },
      },
    ]);

    const result = await service.getSupplierStatement(
      'c1',
      '2026-06-01',
      '2026-06-30',
      'supplier-1',
    );

    expect(prisma.partner.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'supplier-1',
        companyId: 'c1',
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
      },
      select: { id: true },
    });
    expect(prisma.purchaseInvoice.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'c1',
        postingStatus: 'POSTED',
        issuedDate: { lte: new Date('2026-06-30T23:59:59.999Z') },
        supplierId: 'supplier-1',
      },
      include: {
        supplier: true,
        purchaseOrder: { select: { purchaseNo: true } },
      },
    });
    expect(result.totalOpeningBalance).toBe(800);
    expect(result.totalDebit).toBe(600);
    expect(result.totalCredit).toBe(400);
    expect(result.totalEndingBalance).toBe(1000);
    expect(result.suppliers[0]).toMatchObject({
      supplierId: 'supplier-1',
      supplierCode: 'S001',
      supplierName: '供应商A',
      openingBalance: 800,
      periodDebit: 600,
      periodCredit: 400,
      endingBalance: 1000,
    });
    expect(result.suppliers[0].lines).toEqual([
      expect.objectContaining({
        sourceType: 'PURCHASE_INVOICE',
        documentNo: 'PI-001',
        debit: 600,
        credit: 0,
        runningBalance: 1400,
      }),
      expect.objectContaining({
        sourceType: 'SUPPLIER_PAYMENT',
        documentNo: 'SP-001',
        debit: 0,
        credit: 300,
        runningBalance: 1100,
      }),
      expect.objectContaining({
        sourceType: 'SUPPLIER_CREDIT_NOTE',
        documentNo: 'SCN-001',
        debit: 0,
        credit: 100,
        runningBalance: 1000,
      }),
    ]);
  });

  it('lists only open payables with posted credits and payments applied', async () => {
    const { service, prisma } = createService();
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      {
        id: 'pi-1',
        invoiceNo: 'PI-001',
        purchaseOrderId: 'po-1',
        supplierId: 'supplier-1',
        issuedDate: new Date('2026-06-01'),
        dueDate: new Date('2026-06-10'),
        amount: new Decimal(1000),
        status: 'PARTIAL',
        supplier: { id: 'supplier-1', name: '供应商A' },
        purchaseOrder: { id: 'po-1', purchaseNo: 'PO-001' },
        supplierCreditNotes: [
          { amount: new Decimal(100), postingStatus: 'POSTED' },
        ],
        supplierPaymentAllocations: [{ amount: new Decimal(250) }],
      },
      {
        id: 'pi-2',
        invoiceNo: 'PI-002',
        purchaseOrderId: 'po-2',
        supplierId: 'supplier-2',
        issuedDate: new Date('2026-06-02'),
        dueDate: null,
        amount: new Decimal(300),
        status: 'PAID',
        supplier: { id: 'supplier-2', name: '供应商B' },
        purchaseOrder: { id: 'po-2', purchaseNo: 'PO-002' },
        supplierCreditNotes: [],
        supplierPaymentAllocations: [{ amount: new Decimal(300) }],
      },
    ]);

    const result = await service.listOpenPayables('c1');

    expect(prisma.purchaseInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'c1',
          postingStatus: 'POSTED',
          status: { in: ['UNPAID', 'PARTIAL'] },
        }) as unknown,
      }),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        purchaseInvoiceId: 'pi-1',
        invoiceNo: 'PI-001',
        purchaseNo: 'PO-001',
        supplierId: 'supplier-1',
        supplierName: '供应商A',
        amount: 1000,
        creditedAmount: 100,
        paidAmount: 250,
        openAmount: 650,
        status: 'PARTIAL',
      }),
    ]);
  });

  it('rejects supplier credit note when purchase return belongs to another order', async () => {
    const { service, prisma } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi-1',
      supplierId: 'supplier-1',
      amount: new Decimal(1000),
      purchaseOrder: { id: 'po-1', purchaseNo: 'PO-001' },
      supplierCreditNotes: [],
    });
    prisma.inventoryReturnDocument.findFirst.mockResolvedValue({
      id: 'ret-2',
      returnType: 'PURCHASE',
      sourceDocumentNo: 'PO-999',
      status: 'POSTED',
      supplierCreditNote: null,
    });

    await expect(
      service.createSupplierCreditNote('c1', 'pi-1', {
        amount: 200,
        inventoryReturnDocumentId: 'ret-2',
      }),
    ).rejects.toThrow('采购退货单与应付发票采购单不匹配');
    expect(prisma.supplierCreditNote.create).not.toHaveBeenCalled();
  });

  it('posts supplier credit note and updates purchase invoice status', async () => {
    const { service, prisma, tx, eventEmitter } = createService();
    prisma.supplierCreditNote.findFirst.mockResolvedValue({
      id: 'scn-1',
      creditNo: 'SCN-001',
      purchaseInvoiceId: 'pi-1',
      amount: new Decimal(300),
      postingStatus: 'DRAFT',
      purchaseInvoice: {
        id: 'pi-1',
        amount: new Decimal(1000),
        supplierCreditNotes: [
          { amount: new Decimal(700), postingStatus: 'POSTED' },
        ],
      },
    });
    tx.supplierCreditNote.update.mockResolvedValue({
      id: 'scn-1',
      postingStatus: 'POSTED',
    });
    tx.purchaseInvoice.update.mockResolvedValue({});

    const result = await service.postSupplierCreditNote('c1', 'scn-1', 'u1');

    expect(result).toEqual({ id: 'scn-1', postingStatus: 'POSTED' });
    expect(tx.supplierCreditNote.update).toHaveBeenCalledWith({
      where: { id: 'scn-1' },
      data: expect.objectContaining({
        status: 'POSTED',
        postingStatus: 'POSTED',
      }) as unknown,
    });
    expect(tx.purchaseInvoice.update).toHaveBeenCalledWith({
      where: { id: 'pi-1' },
      data: { status: 'PAID' },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'purchase.supplier_credit_note.posted',
      {
        companyId: 'c1',
        idempotencyKey: 'supplier_credit_note_posted:scn-1',
        supplierCreditNoteId: 'scn-1',
        operatorId: 'u1',
      },
    );
  });

  it('creates supplier payment allocated to a payable invoice', async () => {
    const { service, prisma } = createService();
    prisma.partner.findFirst.mockResolvedValue({ id: 'supplier-1' });
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      {
        id: 'pi-1',
        invoiceNo: 'PI-001',
        supplierId: 'supplier-1',
        amount: new Decimal(1000),
        supplierCreditNotes: [
          { amount: new Decimal(200), postingStatus: 'POSTED' },
        ],
        supplierPaymentAllocations: [],
      },
    ]);
    prisma.supplierPayment.create.mockResolvedValue({ id: 'sp-1' });

    await service.createSupplierPayment('c1', {
      supplierId: 'supplier-1',
      amount: 300,
      method: 'BANK_TRANSFER',
      allocations: [{ purchaseInvoiceId: 'pi-1', amount: 300 }],
    });

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: 'supplier-1',
          amount: new Decimal(300),
          method: 'BANK_TRANSFER',
          postingStatus: 'DRAFT',
          companyId: 'c1',
          allocations: {
            create: [
              {
                purchaseInvoiceId: 'pi-1',
                amount: new Decimal(300),
                companyId: 'c1',
              },
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('rejects supplier payment beyond open payable', async () => {
    const { service, prisma } = createService();
    prisma.partner.findFirst.mockResolvedValue({ id: 'supplier-1' });
    prisma.purchaseInvoice.findMany.mockResolvedValue([
      {
        id: 'pi-1',
        invoiceNo: 'PI-001',
        supplierId: 'supplier-1',
        amount: new Decimal(1000),
        supplierCreditNotes: [
          { amount: new Decimal(700), postingStatus: 'POSTED' },
        ],
        supplierPaymentAllocations: [{ amount: new Decimal(250) }],
      },
    ]);

    await expect(
      service.createSupplierPayment('c1', {
        supplierId: 'supplier-1',
        amount: 100,
        method: 'BANK_TRANSFER',
        allocations: [{ purchaseInvoiceId: 'pi-1', amount: 100 }],
      }),
    ).rejects.toThrow('付款金额超过未结应付');
    expect(prisma.supplierPayment.create).not.toHaveBeenCalled();
  });

  it('posts supplier payment and marks payable invoice paid', async () => {
    const { service, prisma, tx, eventEmitter } = createService();
    prisma.supplierPayment.findFirst.mockResolvedValue({
      id: 'sp-1',
      paymentNo: 'SP-001',
      amount: new Decimal(300),
      postingStatus: 'DRAFT',
      allocations: [
        {
          amount: new Decimal(300),
          purchaseInvoice: {
            id: 'pi-1',
            invoiceNo: 'PI-001',
            amount: new Decimal(1000),
            supplierCreditNotes: [
              { amount: new Decimal(700), postingStatus: 'POSTED' },
            ],
            supplierPaymentAllocations: [],
          },
        },
      ],
    });
    tx.supplierPayment.update.mockResolvedValue({
      id: 'sp-1',
      postingStatus: 'POSTED',
    });
    tx.purchaseInvoice.update.mockResolvedValue({});

    const result = await service.postSupplierPayment('c1', 'sp-1', 'u1');

    expect(result).toEqual({ id: 'sp-1', postingStatus: 'POSTED' });
    expect(tx.supplierPayment.update).toHaveBeenCalledWith({
      where: { id: 'sp-1' },
      data: expect.objectContaining({
        postingStatus: 'POSTED',
      }) as unknown,
    });
    expect(tx.purchaseInvoice.update).toHaveBeenCalledWith({
      where: { id: 'pi-1' },
      data: { status: 'PAID' },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'purchase.supplier_payment.posted',
      {
        companyId: 'c1',
        idempotencyKey: 'supplier_payment_posted:sp-1',
        supplierPaymentId: 'sp-1',
        operatorId: 'u1',
      },
    );
  });
});
