import { BadRequestException } from '@nestjs/common';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseOrderStatus } from '@prisma/client';

type MockPrisma = {
  purchaseOrder: { findFirst: jest.Mock };
  goodsReceipt: { create: jest.Mock; findFirst: jest.Mock };
  auditLog: { create: jest.Mock };
  inventoryTransaction: { count: jest.Mock };
  $transaction: jest.Mock;
};

type MockTx = {
  purchaseOrderLine: { update: jest.Mock; findMany: jest.Mock };
  purchaseOrder: { update: jest.Mock };
  goodsReceipt: { update: jest.Mock };
};

describe('GoodsReceiptsService', () => {
  const prisma: MockPrisma = {
    purchaseOrder: { findFirst: jest.fn() },
    goodsReceipt: { create: jest.fn(), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    inventoryTransaction: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  const tx: MockTx = {
    purchaseOrderLine: { update: jest.fn(), findMany: jest.fn() },
    purchaseOrder: { update: jest.fn() },
    goodsReceipt: { update: jest.fn() },
  };
  const inventoryService = { createStockMove: jest.fn() };
  let service: GoodsReceiptsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    service = new GoodsReceiptsService(
      prisma as unknown as ConstructorParameters<
        typeof GoodsReceiptsService
      >[0],
      inventoryService as unknown as ConstructorParameters<
        typeof GoodsReceiptsService
      >[1],
    );
  });

  it('rejects receipt creation when an order line cannot be matched uniquely later', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po1',
      partnerId: 'supplier1',
      status: PurchaseOrderStatus.APPROVED,
      lines: [
        {
          id: 'line1',
          materialId: 'mat1',
          productId: 'prod1',
          quantity: 5,
          receivedQuantity: 0,
        },
        {
          id: 'line2',
          materialId: 'mat1',
          productId: 'prod1',
          quantity: 3,
          receivedQuantity: 0,
        },
      ],
    });

    await expect(
      service.create('company1', 'user1', {
        purchaseOrderId: 'po1',
        partnerId: 'supplier1',
        lines: [
          {
            orderLineId: 'line1',
            materialId: 'mat1',
            productId: 'prod1',
            locationId: 'loc1',
            quantity: 2,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.goodsReceipt.create).not.toHaveBeenCalled();
  });

  it('skips confirming an already confirmed receipt', async () => {
    prisma.goodsReceipt.findFirst.mockResolvedValue({
      id: 'gr1',
      receiptNo: 'GR-001',
      status: 'CONFIRMED',
      lines: [],
      order: null,
    });

    const result = await service.confirm('company1', 'gr1', {}, 'user1');

    expect(result.status).toBe('CONFIRMED');
    expect(result.message).toContain('跳过重复处理');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventoryService.createStockMove).not.toHaveBeenCalled();
  });

  it('increments the uniquely matching purchase order line when confirming', async () => {
    prisma.goodsReceipt.findFirst.mockResolvedValue({
      id: 'gr1',
      receiptNo: 'GR-001',
      status: 'DRAFT',
      lines: [
        {
          id: 'grLine1',
          materialId: 'mat1',
          productId: 'prod1',
          locationId: 'loc1',
          quantity: 2,
          batchNo: null,
        },
      ],
      order: {
        id: 'po1',
        status: PurchaseOrderStatus.APPROVED,
        lines: [
          {
            id: 'poLine1',
            materialId: 'mat1',
            productId: 'prod1',
            quantity: 5,
            receivedQuantity: 0,
          },
        ],
      },
    });
    inventoryService.createStockMove.mockResolvedValue({ id: 'txn1' });
    tx.purchaseOrderLine.findMany.mockResolvedValue([
      { id: 'poLine1', quantity: 5, receivedQuantity: 2 },
    ]);

    const result = await service.confirm('company1', 'gr1', {}, 'user1');

    expect(result.status).toBe('CONFIRMED');
    expect(tx.purchaseOrderLine.update).toHaveBeenCalledWith({
      where: { id: 'poLine1' },
      data: { receivedQuantity: { increment: 2 } },
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
    });
  });

  it('skips reversing when reverse stock moves already exist', async () => {
    prisma.goodsReceipt.findFirst.mockResolvedValue({
      id: 'gr1',
      receiptNo: 'GR-001',
      status: 'CONFIRMED',
      lines: [{ id: 'grLine1', materialId: 'mat1', productId: 'prod1' }],
      orderId: 'po1',
      order: { lines: [] },
    });
    prisma.inventoryTransaction.count.mockResolvedValue(1);

    const result = await service.reverse('company1', 'gr1', {}, 'user1');

    expect(result.message).toContain('跳过重复处理');
    expect(result.reversedLines).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventoryService.createStockMove).not.toHaveBeenCalled();
  });
});
