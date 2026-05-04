import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';

type MockPrisma = {
  material: {
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
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  inventoryTransaction: {
    create: jest.Mock;
  };
};

describe('InventoryService', () => {
  const prisma: MockPrisma = {
    material: {
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

    expect(result.id).toBe('t1');
    expect(tx.stockQuant.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.stockQuant.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { batchNo: 'B2' },
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'inventory.stock_depleted',
      expect.objectContaining({ materialId: 'm1', quantity: 2 }),
    );
  });
});
