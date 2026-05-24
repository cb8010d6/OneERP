import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { PurchaseService } from './purchase.service';

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
  };
  const prisma = {
    partner: {
      findFirst: jest.fn(),
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
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const inventoryService = {
    postPurchaseInbound: jest.fn(),
    createStockMove: jest.fn(),
  };
  const service = new PurchaseService(
    prisma as never,
    inventoryService as never,
  );
  return { service, prisma, tx, inventoryService };
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
        },
      ],
    });
    tx.purchaseReceipt.create.mockResolvedValue({
      id: 'gr-1',
      receiptNo: 'GR-001',
      lines: [
        {
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

    expect(result).toEqual({ id: 'po-1', status: 'PARTIAL_RECEIVED' });
    expect(inventoryService.createStockMove).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        materialId: 'm1',
        quantity: 2,
        destLocationId: 'loc-1',
        batchNo: 'B1',
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
});
