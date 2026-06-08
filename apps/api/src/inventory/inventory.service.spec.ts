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
    findMany: jest.Mock;
  };
  stockQuant: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  purchaseOrderLine: {
    findMany: jest.Mock;
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
  inventoryReturnDocument: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockTx = {
  material: {
    findFirst: jest.Mock;
  };
  materialCost: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  stockQuant: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  inventoryTransaction: {
    create: jest.Mock;
  };
  inventoryLedgerSnapshot: {
    upsert: jest.Mock;
    deleteMany: jest.Mock;
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
      findMany: jest.fn(),
    },
    stockQuant: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    purchaseOrderLine: {
      findMany: jest.fn(),
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
    inventoryReturnDocument: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    material: {
      findFirst: jest.fn(),
    },
    materialCost: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    stockQuant: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
    inventoryLedgerSnapshot: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
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
    kyselyService.withTenant.mockReset();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    tx.stockQuant.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });
    tx.stockQuant.count.mockResolvedValue(1);
    tx.material.findFirst.mockResolvedValue({ unitPrice: 10 });
    tx.materialCost.findUnique.mockResolvedValue(null);
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

  it('returns realtime ledger rows with moving average valuation', async () => {
    kyselyService.withTenant.mockResolvedValue({
      total: 1,
      rows: [
        {
          locationId: 'loc-1',
          locationName: '主库位',
          warehouseId: 'wh-1',
          warehouseName: '主仓',
          materialId: 'm1',
          materialSku: 'MAT-1',
          materialName: '钢板',
          materialUnit: 'pcs',
          minStock: 1,
          netQty: 5,
          batchCount: 2,
          averageCost: 12.5,
        },
      ],
    });

    const result = await service.getRealtimeLedger('c1', {
      page: 1,
      limit: 20,
    });

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        materialId: 'm1',
        averageCost: 12.5,
        inventoryValue: 62.5,
        isLow: false,
      }),
    );
  });

  it('returns replenishment suggestions net of incoming purchase quantities', async () => {
    prisma.material.findMany.mockResolvedValue([
      {
        id: 'm1',
        sku: 'MAT-1',
        name: '钢板',
        category: '板材',
        unit: 'pcs',
        minStock: 20,
        unitPrice: 12.5,
      },
      {
        id: 'm2',
        sku: 'MAT-2',
        name: '螺丝',
        category: '标准件',
        unit: 'pcs',
        minStock: 10,
        unitPrice: 1,
      },
    ]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: 5 },
      { materialId: 'm1', quantity: 3 },
      { materialId: 'm2', quantity: 10 },
    ]);
    prisma.purchaseOrderLine.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: 8, receivedQty: 2 },
      { materialId: 'm2', quantity: 5, receivedQty: 0 },
    ]);

    const result = await service.getReplenishmentSuggestions('c1');

    expect(prisma.material.findMany).toHaveBeenCalledWith({
      where: { OR: [{ companyId: 'c1' }, { companyId: null }] },
      orderBy: [{ category: 'asc' }, { sku: 'asc' }],
    });
    expect(prisma.stockQuant.findMany).toHaveBeenCalledWith({
      where: { location: { companyId: 'c1' } },
      select: {
        materialId: true,
        quantity: true,
      },
    });
    expect(prisma.purchaseOrderLine.findMany).toHaveBeenCalledWith({
      where: {
        purchaseOrder: {
          companyId: 'c1',
          status: { in: ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'] },
        },
      },
      select: {
        materialId: true,
        quantity: true,
        receivedQty: true,
      },
    });
    expect(result).toEqual({
      totalSuggestions: 1,
      totalShortageQty: 6,
      totalEstimatedAmount: 75,
      rows: [
        {
          materialId: 'm1',
          sku: 'MAT-1',
          name: '钢板',
          category: '板材',
          unit: 'pcs',
          minStock: 20,
          onHandQty: 8,
          incomingQty: 6,
          projectedQty: 14,
          shortageQty: 6,
          suggestedPurchaseQty: 6,
          unitPrice: 12.5,
          estimatedAmount: 75,
          severity: 'SHORTAGE',
        },
      ],
    });
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

  it('creates a sales return document after reversing shipped stock', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001' });
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        materialId: 'm1',
        quantity: 2,
        sourceLocationId: 'loc-ship',
      },
    ]);
    prisma.inventoryReturnDocument.upsert.mockResolvedValue({
      id: 'ret1',
      returnNo: 'SR-1',
      lines: [{ id: 'rl1' }],
    });
    const moveSpy = jest.spyOn(service, 'createStockMove').mockResolvedValue({
      id: 'move-rev-1',
      type: 'INBOUND',
      materialId: 'm1',
      quantity: 2,
      destLocationId: 'loc-return',
      batchNo: 'B1',
      referenceNo: 'SALE-SHIP-REV-ORD-001',
    });

    try {
      const result = await service.reverseSaleOrderShipment(
        'c1',
        'o1',
        { destLocationId: 'loc-return', note: '客户退货' },
        'u1',
      );

      expect(result.returnDocument).toEqual(
        expect.objectContaining({ id: 'ret1', returnNo: 'SR-1' }),
      );
      expect(prisma.inventoryReturnDocument.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_referenceNo: {
              companyId: 'c1',
              referenceNo: 'SALE-SHIP-REV-ORD-001',
            },
          },
          create: expect.objectContaining({
            returnType: 'SALES',
            sourceDocumentNo: 'ORD-001',
            lines: {
              create: [
                expect.objectContaining({
                  materialId: 'm1',
                  quantity: 2,
                  locationId: 'loc-return',
                  inventoryMoveId: 'move-rev-1',
                }),
              ],
            },
          }),
        }),
      );
    } finally {
      moveSpy.mockRestore();
    }
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

  it('creates a purchase return document after reversing inbound stock', async () => {
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        materialId: 'm1',
        quantity: 3,
        destLocationId: 'loc-receive',
      },
    ]);
    prisma.inventoryReturnDocument.upsert.mockResolvedValue({
      id: 'ret2',
      returnNo: 'PR-1',
      lines: [{ id: 'rl2' }],
    });
    const moveSpy = jest.spyOn(service, 'createStockMove').mockResolvedValue({
      id: 'move-rev-2',
      type: 'OUTBOUND',
      materialId: 'm1',
      quantity: 3,
      sourceLocationId: 'loc-receive',
      batchNo: 'B2',
      referenceNo: 'PURCHASE-IN-REV-PO-001',
    });

    try {
      const result = await service.reversePurchaseInbound(
        'c1',
        'PO-001',
        { sourceLocationId: 'loc-receive', note: '供应商退货' },
        'u1',
      );

      expect(result.returnDocument).toEqual(
        expect.objectContaining({ id: 'ret2', returnNo: 'PR-1' }),
      );
      expect(prisma.inventoryReturnDocument.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_referenceNo: {
              companyId: 'c1',
              referenceNo: 'PURCHASE-IN-REV-PO-001',
            },
          },
          create: expect.objectContaining({
            returnType: 'PURCHASE',
            sourceDocumentNo: 'PO-001',
            lines: {
              create: [
                expect.objectContaining({
                  materialId: 'm1',
                  quantity: 3,
                  locationId: 'loc-receive',
                  inventoryMoveId: 'move-rev-2',
                }),
              ],
            },
          }),
        }),
      );
    } finally {
      moveSpy.mockRestore();
    }
  });

  it('refreshes ledger snapshot after inbound stock move', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({
      id: 'loc-dest',
      name: 'Finished Goods',
      warehouseId: 'w1',
    });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });
    tx.stockQuant.aggregate.mockResolvedValue({ _sum: { quantity: 12 } });
    tx.stockQuant.count.mockResolvedValue(2);
    tx.inventoryTransaction.create.mockResolvedValue({
      id: 't-in',
      type: 'INBOUND',
      materialId: 'm1',
      quantity: 5,
      referenceNo: 'R-IN',
    });

    await service.createStockMove(
      'c1',
      {
        destLocationId: 'loc-dest',
        materialId: 'm1',
        quantity: 5,
        batchNo: 'B1',
        referenceNo: 'R-IN',
      },
      'u1',
    );

    expect(tx.inventoryLedgerSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_locationId_materialId: {
            companyId: 'c1',
            locationId: 'loc-dest',
            materialId: 'm1',
          },
        },
        create: expect.objectContaining({ netQty: 12, batchCount: 2 }),
        update: expect.objectContaining({ netQty: 12, batchCount: 2 }),
      }),
    );
  });

  it('updates moving average cost after inbound stock move', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({
      id: 'loc-dest',
      name: 'Finished Goods',
      warehouseId: 'w1',
    });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });
    tx.materialCost.findUnique.mockResolvedValue({
      quantityOnHand: 10,
      averageCost: 10,
      inventoryValue: 100,
    });
    tx.inventoryTransaction.create.mockResolvedValue({
      id: 't-in',
      type: 'INBOUND',
      materialId: 'm1',
      quantity: 5,
      referenceNo: 'R-IN',
    });

    await service.createStockMove(
      'c1',
      {
        destLocationId: 'loc-dest',
        materialId: 'm1',
        quantity: 5,
        unitCost: 16,
        referenceNo: 'R-IN',
      },
      'u1',
    );

    expect(tx.materialCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_materialId: {
            companyId: 'c1',
            materialId: 'm1',
          },
        },
        update: expect.objectContaining({
          quantityOnHand: 15,
          averageCost: 12,
          inventoryValue: 180,
        }),
      }),
    );
  });

  it('emits outbound depletion with moving average unit cost', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({
      id: 'loc-source',
      name: 'L1',
      warehouseId: 'w1',
    });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });
    tx.materialCost.findUnique.mockResolvedValue({
      quantityOnHand: 10,
      averageCost: 8,
      inventoryValue: 80,
    });
    tx.stockQuant.findFirst.mockResolvedValue({ id: 'q1', batchNo: 'B1' });
    tx.stockQuant.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryTransaction.create.mockResolvedValue({
      id: 't-out',
      type: 'OUTBOUND',
      materialId: 'm1',
      quantity: 2,
      referenceNo: 'R-OUT',
    });

    await service.createStockMove(
      'c1',
      {
        sourceLocationId: 'loc-source',
        materialId: 'm1',
        quantity: 2,
        referenceNo: 'R-OUT',
      },
      'u1',
    );

    expect(tx.materialCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          quantityOnHand: 8,
          averageCost: 8,
          inventoryValue: 64,
        }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({
        materialId: 'm1',
        quantity: 2,
        unitCost: 8,
      }),
    );
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
