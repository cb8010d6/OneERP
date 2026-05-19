/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';

type MockPrisma = {
  product: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  material: {
    findFirst: jest.Mock;
  };
  stockQuant: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  stockLocation: {
    findFirst: jest.Mock;
  };
  order: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  inventoryTransaction: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockTx = {
  stockQuant: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  inventoryTransaction: {
    create: jest.Mock;
  };
};

describe('InventoryService', () => {
  const prisma: MockPrisma = {
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    material: {
      findFirst: jest.fn(),
    },
    stockQuant: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    stockLocation: {
      findFirst: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    inventoryTransaction: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    stockQuant: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
  };

  const eventEmitter = {
    emit: jest.fn(),
  };

  let service: InventoryService;

  const kyselyService = {
    withTenant: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    service = new InventoryService(
      prisma as unknown as ConstructorParameters<typeof InventoryService>[0],
      kyselyService as unknown as ConstructorParameters<
        typeof InventoryService
      >[1],
      eventEmitter as unknown as ConstructorParameters<
        typeof InventoryService
      >[2],
    );
  });

  it('throws when sale order is missing on reverse posting', async () => {
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skips reverse when reverse moves already exist', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001' });
    prisma.inventoryTransaction.count.mockResolvedValue(1);

    const result = await service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1');

    expect(result.message).toContain('已存在');
    expect(prisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
  });

  it('throws when no shipped outbound moves found', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001' });
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);

    await expect(
      service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ships available quantities per line and marks the order as PARTIAL_SHIPPED', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      orderNo: 'ORD-001',
      items: [
        { productId: 'p1', quantity: 5 },
        { productId: 'p2', quantity: 3 },
      ],
    });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', materialId: 'm1', name: 'Phone', sku: 'SKU-001' },
      { id: 'p2', materialId: 'm2', name: 'Case', sku: 'SKU-002' },
    ]);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: 2 },
    ]);
    prisma.stockQuant.findMany.mockImplementation(
      ({ where }: { where: { materialId: string } }) => {
        if (where.materialId === 'm1') {
          return [
            {
              locationId: 'loc-1',
              batchNo: 'B1-A',
              quantity: 1,
              location: { name: '主仓' },
            },
            {
              locationId: 'loc-1',
              batchNo: 'B1-B',
              quantity: 1,
              location: { name: '主仓' },
            },
          ];
        }

        if (where.materialId === 'm2') {
          return [
            {
              locationId: 'loc-1',
              batchNo: 'B2',
              quantity: 3,
              location: { name: '主仓' },
            },
          ];
        }

        return [];
      },
    );
    tx.stockQuant.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryTransaction.create
      .mockResolvedValueOnce({
        id: 't1',
        batchNo: 'B1-A',
        referenceNo: 'SALE-SHIP-ORD-001',
        type: 'OUTBOUND',
        materialId: 'm1',
        quantity: 1,
      })
      .mockResolvedValueOnce({
        id: 't2',
        batchNo: 'B1-B',
        referenceNo: 'SALE-SHIP-ORD-001',
        type: 'OUTBOUND',
        materialId: 'm1',
        quantity: 1,
      })
      .mockResolvedValueOnce({
        id: 't3',
        batchNo: 'B2',
        referenceNo: 'SALE-SHIP-ORD-001',
        type: 'OUTBOUND',
        materialId: 'm2',
        quantity: 3,
      });
    prisma.order.update.mockResolvedValue({});

    const result = (await service.postSaleOrderShipment(
      'c1',
      'o1',
      {
        sourceLocationId: 'loc-1',
        items: [
          { productId: 'p1', shipQuantity: 5 },
          { productId: 'p2', shipQuantity: 3 },
        ],
      },
      'u1',
    )) as {
      status: string;
      totalOrdered: number;
      totalShipped: number;
      postedLines: Array<Record<string, unknown>>;
    };

    expect(result.status).toBe('PARTIAL_SHIPPED');
    expect(result.totalOrdered).toBe(8);
    expect(result.totalShipped).toBe(7);
    expect(result.postedLines).toHaveLength(2);
    expect(result.postedLines[0]).toEqual(
      expect.objectContaining({
        productId: 'p1',
        materialId: 'm1',
        requestedQuantity: 5,
        quantity: 2,
        allocations: expect.arrayContaining([
          expect.objectContaining({ batchNo: 'B1-A', quantity: 1 }),
          expect.objectContaining({ batchNo: 'B1-B', quantity: 1 }),
        ]),
      }),
    );
    expect(result.postedLines[1]).toEqual(
      expect.objectContaining({
        productId: 'p2',
        materialId: 'm2',
        requestedQuantity: 3,
        quantity: 3,
      }),
    );
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'PARTIAL_SHIPPED' },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({ materialId: 'm1', quantity: 1 }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({ materialId: 'm1', quantity: 1 }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({ materialId: 'm2', quantity: 3 }),
    );
  });

  it('keeps order status unchanged when no stock is posted', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      orderNo: 'ORD-002',
      status: 'DRAFT',
      items: [{ productId: 'p1', quantity: 2 }],
    });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', materialId: 'm1', name: 'Phone', sku: 'SKU-001' },
    ]);
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.stockQuant.findMany.mockResolvedValue([]);

    const result = await service.postSaleOrderShipment(
      'c1',
      'o1',
      {
        sourceLocationId: 'loc-1',
        items: [{ productId: 'p1', shipQuantity: 2 }],
      },
      'u1',
    );

    expect(result.postingStatus).toBe('NO_STOCK_POSTED');
    expect(result.status).toBe('DRAFT');
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('skips purchase reverse when reverse moves already exist', async () => {
    prisma.inventoryTransaction.count.mockResolvedValue(1);

    const result = await service.reversePurchaseInbound(
      'c1',
      'PO-001',
      {},
      'u1',
    );

    expect(result.message).toContain('已存在');
    expect(prisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
  });

  it('throws when purchase inbound moves are missing', async () => {
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);

    await expect(
      service.reversePurchaseInbound('c1', 'PO-001', {}, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws conflict when outbound conditional deduction fails', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({
      id: 'loc-source',
      name: 'L1',
      warehouseId: 'w1',
    });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });
    tx.stockQuant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createStockMove(
        'c1',
        {
          sourceLocationId: 'loc-source',
          materialId: 'm1',
          quantity: 2,
          batchNo: 'B1',
        },
        'u1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('retries no-batch deduction and succeeds on second candidate', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({
      id: 'loc-source',
      name: 'L1',
      warehouseId: 'w1',
    });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });

    tx.stockQuant.findFirst
      .mockResolvedValueOnce({ id: 'q1', batchNo: 'B1' })
      .mockResolvedValueOnce({ id: 'q2', batchNo: 'B2' });

    tx.stockQuant.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    tx.inventoryTransaction.create.mockResolvedValue({
      id: 't1',
      type: 'OUTBOUND',
      materialId: 'm1',
      quantity: 2,
      referenceNo: 'R1',
    });

    const result: { id: string } = (await service.createStockMove(
      'c1',
      {
        sourceLocationId: 'loc-source',
        materialId: 'm1',
        quantity: 2,
        referenceNo: 'R1',
      },
      'u1',
    )) as unknown as { id: string };

    type CreateCall = {
      data: {
        batchNo: string;
      };
    };

    const createCalls = tx.inventoryTransaction.create.mock
      .calls as unknown as Array<[CreateCall]>;
    const createCall = createCalls[0]?.[0];

    expect(result.id).toBe('t1');
    expect(tx.stockQuant.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.stockQuant.updateMany).toHaveBeenCalledTimes(2);
    expect(createCall.data.batchNo).toBe('B2');
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({ materialId: 'm1', quantity: 2 }),
    );
  });
});
