import { NotFoundException } from '@nestjs/common';
import { ProductionService } from './production.service';

type MockPrisma = {
  order: {
    findFirst: jest.Mock;
  };
  workOrder: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  workReport: {
    create: jest.Mock;
  };
  product: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  bom: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockTx = {
  workReport: {
    create: jest.Mock;
  };
  workOrder: {
    update: jest.Mock;
    create: jest.Mock;
  };
  order: {
    update: jest.Mock;
  };
};

describe('ProductionService', () => {
  const prisma: MockPrisma = {
    order: {
      findFirst: jest.fn(),
    },
    workOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    workReport: {
      create: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    bom: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const inventoryService = {
    createStockMove: jest.fn(),
  };

  const tx: MockTx = {
    workReport: {
      create: jest.fn(),
    },
    workOrder: {
      update: jest.fn(),
      create: jest.fn(),
    },
    order: {
      update: jest.fn(),
    },
  };

  let service: ProductionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    prisma.product.findFirst.mockResolvedValue(null);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.bom.findMany.mockResolvedValue([]);
    service = new ProductionService(
      prisma as unknown as ConstructorParameters<typeof ProductionService>[0],
      inventoryService as unknown as ConstructorParameters<
        typeof ProductionService
      >[1],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWorkOrder', () => {
    it('should create a work order when order exists', async () => {
      const order = { id: 'o1', companyId: 'c1' };
      const workOrder = {
        id: 'wo1',
        workOrderNo: 'WO-123',
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
        status: 'PENDING',
        companyId: 'c1',
      };
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.workOrder.create.mockResolvedValue(workOrder);

      const result: {
        id: string;
        workOrderNo: string;
        orderId: string;
        productId: string;
        plannedQty: number;
        status: string;
        companyId: string;
      } = (await service.createWorkOrder('c1', {
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
      })) as unknown as {
        id: string;
        workOrderNo: string;
        orderId: string;
        productId: string;
        plannedQty: number;
        status: string;
        companyId: string;
      };

      type CreateCall = {
        data: {
          orderId: string;
          productId: string;
          plannedQty: number;
          status: string;
          companyId: string;
          workOrderNo: string;
        };
      };

      const createCalls = prisma.workOrder.create.mock
        .calls as unknown as Array<[CreateCall]>;
      const createCall = createCalls[0]?.[0];

      expect(result).toEqual(workOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'o1', companyId: 'c1' },
      });
      expect(createCall.data.orderId).toBe('o1');
      expect(createCall.data.productId).toBe('p1');
      expect(createCall.data.plannedQty).toBe(100);
      expect(createCall.data.status).toBe('PENDING');
      expect(createCall.data.companyId).toBe('c1');
      expect(createCall.data.workOrderNo).toMatch(/^WO-/);
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createWorkOrder('c1', {
          orderId: 'nonexistent',
          productId: 'p1',
          plannedQty: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateWorkOrdersFromSalesOrder', () => {
    it('creates one work order per order product and moves order into production', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderNo: 'ORD-001',
        status: 'SUBMITTED',
        items: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-1', quantity: 3 },
          { productId: 'product-2', quantity: 1 },
        ],
        workOrders: [],
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'product-1', sku: 'P1', name: '产品1' },
        { id: 'product-2', sku: 'P2', name: '产品2' },
      ]);
      prisma.bom.findMany.mockResolvedValue([
        { productId: 'product-1' },
        { productId: 'product-2' },
      ]);
      tx.workOrder.create
        .mockResolvedValueOnce({
          id: 'wo-1',
          workOrderNo: 'WO-001',
          orderId: 'order-1',
          productId: 'product-1',
          plannedQty: 5,
          status: 'PENDING',
          companyId: 'c1',
        })
        .mockResolvedValueOnce({
          id: 'wo-2',
          workOrderNo: 'WO-002',
          orderId: 'order-1',
          productId: 'product-2',
          plannedQty: 1,
          status: 'PENDING',
          companyId: 'c1',
        });

      const result = await service.generateWorkOrdersFromSalesOrder(
        'c1',
        'order-1',
        {},
      );

      expect(result.created).toHaveLength(2);
      const workOrderCreateCalls = tx.workOrder.create.mock.calls as Array<
        [{ data: { productId: string; plannedQty: number } }]
      >;
      expect(workOrderCreateCalls[0]?.[0].data.productId).toBe('product-1');
      expect(workOrderCreateCalls[0]?.[0].data.plannedQty).toBe(5);
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'IN_PRODUCTION' },
      });
    });

    it('rejects generation when default BOM is missing', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderNo: 'ORD-001',
        status: 'SUBMITTED',
        items: [{ productId: 'product-1', quantity: 2 }],
        workOrders: [],
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'product-1', sku: 'P1', name: '产品1' },
      ]);
      prisma.bom.findMany.mockResolvedValue([]);

      await expect(
        service.generateWorkOrdersFromSalesOrder('c1', 'order-1', {}),
      ).rejects.toThrow('未配置默认 BOM');
    });
  });

  describe('getWorkOrders', () => {
    it('should return paginated work orders', async () => {
      const workOrders = [{ id: 'wo1', status: 'PENDING' }];
      prisma.workOrder.findMany.mockResolvedValue(workOrders);
      prisma.workOrder.count.mockResolvedValue(1);

      const result = await service.getWorkOrders('c1', { page: 1, limit: 20 });

      expect(result.data).toEqual(workOrders);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('submitWorkReport', () => {
    it('should submit a work report and update work order', async () => {
      const workOrder = {
        id: 'wo1',
        workOrderNo: 'WO-001',
        productId: 'p1',
        companyId: 'c1',
        actualQty: 10,
        plannedQty: 100,
        status: 'PENDING',
        product: { materialId: 'fg-1' },
      };
      prisma.workOrder.findFirst.mockResolvedValue(workOrder);
      prisma.bom.findFirst.mockResolvedValue({
        id: 'bom-1',
        lines: [{ materialId: 'raw-1', quantity: 2, scrapRate: 0.1 }],
      });
      tx.workReport.create.mockResolvedValue({
        id: 'wr1',
        workOrderId: 'wo1',
        goodQty: 20,
        defectQty: 2,
      });
      tx.workOrder.update.mockResolvedValue({});

      const result = (await service.submitWorkReport('c1', 'wo1', 'u1', {
        goodQty: 20,
        defectQty: 2,
        sourceLocationId: 'raw-loc',
        destLocationId: 'fg-loc',
        batchNo: 'FG-B1',
      })) as { id: string };

      expect(result.id).toBe('wr1');
      expect(tx.workReport.create).toHaveBeenCalled();
      expect(tx.workOrder.update).toHaveBeenCalledWith({
        where: { id: 'wo1' },
        data: { actualQty: 30, status: 'IN_PROGRESS' },
      });
      expect(inventoryService.createStockMove).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          materialId: 'raw-1',
          sourceLocationId: 'raw-loc',
          quantity: 44,
          referenceNo: 'PRODUCTION-ISSUE-WO-001',
        }),
        'u1',
      );
      expect(inventoryService.createStockMove).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          materialId: 'fg-1',
          destLocationId: 'fg-loc',
          quantity: 20,
          batchNo: 'FG-B1',
          referenceNo: 'PRODUCTION-RECEIPT-WO-001',
        }),
        'u1',
      );
    });

    it('should mark work order as COMPLETED when actualQty meets plannedQty', async () => {
      const workOrder = {
        id: 'wo1',
        workOrderNo: 'WO-002',
        productId: 'p1',
        companyId: 'c1',
        actualQty: 80,
        plannedQty: 100,
        status: 'IN_PROGRESS',
        product: { materialId: 'fg-1' },
      };
      prisma.workOrder.findFirst.mockResolvedValue(workOrder);
      prisma.bom.findFirst.mockResolvedValue({
        id: 'bom-1',
        lines: [{ materialId: 'raw-1', quantity: 1, scrapRate: 0 }],
      });
      tx.workReport.create.mockResolvedValue({
        id: 'wr2',
        workOrderId: 'wo1',
        goodQty: 25,
        defectQty: 0,
      });
      tx.workOrder.update.mockResolvedValue({});

      await service.submitWorkReport('c1', 'wo1', 'u1', {
        goodQty: 25,
        defectQty: 0,
        sourceLocationId: 'raw-loc',
        destLocationId: 'fg-loc',
      });

      expect(tx.workOrder.update).toHaveBeenCalledWith({
        where: { id: 'wo1' },
        data: { actualQty: 105, status: 'COMPLETED' },
      });
    });

    it('should explode nested BOM and issue raw materials only', async () => {
      const workOrder = {
        id: 'wo-nested',
        workOrderNo: 'WO-003',
        productId: 'parent-product',
        companyId: 'c1',
        actualQty: 0,
        plannedQty: 10,
        status: 'PENDING',
        product: { materialId: 'fg-parent' },
      };
      prisma.workOrder.findFirst.mockResolvedValue(workOrder);
      prisma.bom.findFirst
        .mockResolvedValueOnce({
          id: 'bom-parent',
          lines: [
            { materialId: 'semi-material', quantity: 2, scrapRate: 0 },
            { materialId: 'raw-shared', quantity: 1, scrapRate: 0 },
          ],
        })
        .mockResolvedValueOnce({ id: 'bom-semi' })
        .mockResolvedValueOnce({
          id: 'bom-semi',
          lines: [
            { materialId: 'raw-a', quantity: 3, scrapRate: 0 },
            { materialId: 'raw-shared', quantity: 2, scrapRate: 0 },
          ],
        });
      prisma.product.findFirst
        .mockResolvedValueOnce({ id: 'semi-product' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      tx.workReport.create.mockResolvedValue({
        id: 'wr3',
        workOrderId: 'wo-nested',
        goodQty: 5,
        defectQty: 0,
      });
      tx.workOrder.update.mockResolvedValue({});

      await service.submitWorkReport('c1', 'wo-nested', 'u1', {
        goodQty: 5,
        defectQty: 0,
        sourceLocationId: 'raw-loc',
        destLocationId: 'fg-loc',
      });

      expect(inventoryService.createStockMove).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          materialId: 'raw-a',
          quantity: 30,
          referenceNo: 'PRODUCTION-ISSUE-WO-003',
        }),
        'u1',
      );
      expect(inventoryService.createStockMove).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          materialId: 'raw-shared',
          quantity: 25,
          referenceNo: 'PRODUCTION-ISSUE-WO-003',
        }),
        'u1',
      );
      expect(inventoryService.createStockMove).not.toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ materialId: 'semi-material' }),
        'u1',
      );
    });

    it('should throw NotFoundException when work order not found', async () => {
      prisma.workOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.submitWorkReport('c1', 'nonexistent', 'u1', {
          goodQty: 10,
          defectQty: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
