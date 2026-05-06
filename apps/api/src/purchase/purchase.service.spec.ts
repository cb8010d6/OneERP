import { BadRequestException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { PurchaseService } from './purchase.service';

type MockPrisma = {
  partner: { findFirst: jest.Mock };
  material: { findMany: jest.Mock; findUnique: jest.Mock };
  purchaseOrder: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  stockLocation: { findFirst: jest.Mock };
  purchaseOrderLine: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

type MockTx = {
  purchaseOrderLine: { update: jest.Mock; findMany: jest.Mock };
  purchaseOrder: { update: jest.Mock };
};

describe('PurchaseService', () => {
  const prisma: MockPrisma = {
    partner: { findFirst: jest.fn() },
    material: { findMany: jest.fn(), findUnique: jest.fn() },
    purchaseOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    stockLocation: { findFirst: jest.fn() },
    purchaseOrderLine: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const tx: MockTx = {
    purchaseOrderLine: { update: jest.fn(), findMany: jest.fn() },
    purchaseOrder: { update: jest.fn() },
  };
  const inventoryService = { createStockMove: jest.fn() };
  let service: PurchaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    service = new PurchaseService(
      prisma as unknown as ConstructorParameters<typeof PurchaseService>[0],
      inventoryService as unknown as ConstructorParameters<
        typeof PurchaseService
      >[1],
    );
  });

  it('creates legacy purchase orders as approved instead of confirmed', async () => {
    prisma.partner.findFirst.mockResolvedValue({ id: 'supplier1' });
    prisma.material.findMany.mockResolvedValue([{ id: 'mat1' }]);
    prisma.purchaseOrder.create.mockResolvedValue({ id: 'po1' });

    await service.createPurchaseOrder('company1', {
      supplierId: 'supplier1',
      items: [{ materialId: 'mat1', quantity: 2, unitPrice: 5 }],
    });

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PurchaseOrderStatus.APPROVED,
        }),
      }),
    );
  });

  it('blocks receiving purchase orders before approval', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po1',
      orderNo: 'PO-001',
      status: PurchaseOrderStatus.SUBMITTED,
      lines: [
        {
          id: 'line1',
          materialId: 'mat1',
          quantity: 5,
          receivedQuantity: 0,
        },
      ],
    });

    await expect(
      service.receivePurchaseItem(
        'company1',
        {
          purchaseOrderId: 'po1',
          itemId: 'line1',
          quantity: 1,
          destLocationId: 'loc1',
        },
        'user1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventoryService.createStockMove).not.toHaveBeenCalled();
  });

  it('uses approved purchase orders for pending receivables', async () => {
    prisma.purchaseOrder.findMany.mockResolvedValue([]);

    await service.getPendingReceivableOrders('company1');

    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company1',
          status: {
            in: [
              PurchaseOrderStatus.APPROVED,
              PurchaseOrderStatus.PARTIALLY_RECEIVED,
            ],
          },
        },
      }),
    );
  });
});
