import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

type MockPrisma = {
  material: { findFirst: jest.Mock };
  stockLocation: { findFirst: jest.Mock };
  order: { findFirst: jest.Mock; update: jest.Mock };
  product: { findFirst: jest.Mock };
  inventoryTransaction: { count: jest.Mock; findMany: jest.Mock };
  stockPicking: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  stockMove: { update: jest.Mock };
  $transaction: jest.Mock;
};

type MockTx = {
  stockQuant: { updateMany: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock };
  inventoryTransaction: { create: jest.Mock };
  stockMove: { update: jest.Mock };
  stockPicking: { update: jest.Mock };
  order: { update: jest.Mock };
};

describe('InventoryService', () => {
  const prisma: MockPrisma = {
    material: { findFirst: jest.fn() },
    stockLocation: { findFirst: jest.fn() },
    order: { findFirst: jest.fn(), update: jest.fn() },
    product: { findFirst: jest.fn() },
    inventoryTransaction: { count: jest.fn(), findMany: jest.fn() },
    stockPicking: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    stockMove: { update: jest.fn() },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    stockQuant: { updateMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    stockMove: { update: jest.fn() },
    stockPicking: { update: jest.fn() },
    order: { update: jest.fn() },
  };

  const eventEmitter = { emit: jest.fn() };
  let service: InventoryService;
  const kyselyService = { withTenant: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((callback: (trx: MockTx) => unknown) => callback(tx));
    service = new InventoryService(
      prisma as unknown as ConstructorParameters<typeof InventoryService>[0],
      kyselyService as unknown as ConstructorParameters<typeof InventoryService>[1],
      eventEmitter as unknown as ConstructorParameters<typeof InventoryService>[2],
    );
  });

  it('throws when sale order is missing on reverse posting', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skips reverse when reverse moves already exist', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001' });
    prisma.inventoryTransaction.count.mockResolvedValue(1);
    const result = await service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1');
    expect(result.message).toContain('已存在');
  });

  it('throws when no shipped outbound moves found', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001' });
    prisma.inventoryTransaction.count.mockResolvedValue(0);
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    await expect(service.reverseSaleOrderShipment('c1', 'o1', {}, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws conflict when outbound conditional deduction fails', async () => {
    prisma.stockLocation.findFirst.mockResolvedValue({ id: 'loc-source', name: 'L1', warehouseId: 'w1' });
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 10 });
    tx.stockQuant.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createStockMove('c1', { sourceLocationId: 'loc-source', materialId: 'm1', quantity: 2, batchNo: 'B1' }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
  describe('createSaleOrderPicking', () => {
    it('throws when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.createSaleOrderPicking('c1', 'o1', {}, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when order has no items', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001', items: [] });
      await expect(service.createSaleOrderPicking('c1', 'o1', {}, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns existing picking when one already exists', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNo: 'ORD-001', items: [{ productId: 'p1', quantity: 5 }] });
      prisma.stockPicking.findFirst.mockResolvedValue({ id: 'pk1', pickingNo: 'PICK-001', status: 'DRAFT' });
      const result = await service.createSaleOrderPicking('c1', 'o1', {}, 'u1');
      expect(result.pickingId).toBe('pk1');
      expect(result.message).toContain('已存在');
      expect(prisma.stockPicking.create).not.toHaveBeenCalled();
    });

    it('creates picking with moves from order items', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1', orderNo: 'ORD-001',
        items: [{ productId: 'p1', quantity: 3 }, { productId: 'p2', quantity: 2 }],
      });
      prisma.stockPicking.findFirst.mockResolvedValue(null);
      prisma.product.findFirst
        .mockResolvedValueOnce({ id: 'p1', materialId: 'm1', name: 'Product1' })
        .mockResolvedValueOnce({ id: 'p2', materialId: 'm2', name: 'Product2' });
      prisma.stockPicking.create.mockResolvedValue({
        id: 'pk1', pickingNo: 'PICK-001', status: 'DRAFT',
        moves: [{ id: 'mv1', lineNo: 1, materialId: 'm1', quantity: 3 }, { id: 'mv2', lineNo: 2, materialId: 'm2', quantity: 2 }],
      });
      const result = await service.createSaleOrderPicking('c1', 'o1', {}, 'u1');
      expect(result.pickingId).toBe('pk1');
      expect(result.status).toBe('DRAFT');
      expect(result.moveCount).toBe(2);
    });
  });

  describe('confirmStockPicking', () => {
    it('throws when picking not found', async () => {
      prisma.stockPicking.findFirst.mockResolvedValue(null);
      await expect(service.confirmStockPicking('c1', 'pk1', {}, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('skips when picking is already DONE (idempotent)', async () => {
      prisma.stockPicking.findFirst.mockResolvedValue({ id: 'pk1', pickingNo: 'PICK-001', status: 'DONE', moves: [] });
      const result = await service.confirmStockPicking('c1', 'pk1', {}, 'u1');
      expect(result.status).toBe('DONE');
      expect(result.message).toContain('跳过重复处理');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws when picking is CANCELLED', async () => {
      prisma.stockPicking.findFirst.mockResolvedValue({ id: 'pk1', pickingNo: 'PICK-001', status: 'CANCELLED', moves: [] });
      await expect(service.confirmStockPicking('c1', 'pk1', {}, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
