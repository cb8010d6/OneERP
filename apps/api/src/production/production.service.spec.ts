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
  material: {
    findMany: jest.Mock;
  };
  bom: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  stockQuant: {
    findMany: jest.Mock;
  };
  purchaseOrderLine: {
    findMany: jest.Mock;
  };
  engineeringDocumentRevision: {
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
  auditLog: {
    create: jest.Mock;
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
    material: {
      findMany: jest.fn(),
    },
    bom: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    stockQuant: {
      findMany: jest.fn(),
    },
    purchaseOrderLine: {
      findMany: jest.fn(),
    },
    engineeringDocumentRevision: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const inventoryService = {
    createStockMove: jest.fn(),
  };

  const purchaseService = {
    createPurchaseOrder: jest.fn(),
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
    auditLog: {
      create: jest.fn(),
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
    prisma.material.findMany.mockResolvedValue([]);
    prisma.bom.findMany.mockResolvedValue([]);
    prisma.stockQuant.findMany.mockResolvedValue([]);
    prisma.purchaseOrderLine.findMany.mockResolvedValue([]);
    prisma.engineeringDocumentRevision.findMany.mockResolvedValue([]);
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    service = new ProductionService(
      prisma as unknown as ConstructorParameters<typeof ProductionService>[0],
      inventoryService as unknown as ConstructorParameters<
        typeof ProductionService
      >[1],
      purchaseService as unknown as ConstructorParameters<
        typeof ProductionService
      >[2],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWorkOrder', () => {
    it('should create a work order when order exists', async () => {
      const order = {
        id: 'o1',
        companyId: 'c1',
        salesId: 'sales-1',
        items: [{ productId: 'p1' }],
      };
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
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
      prisma.engineeringDocumentRevision.findMany.mockResolvedValue([
        {
          id: 'revision-1',
          engineeringDocument: {
            productId: 'p1',
            orderId: 'o1',
            currentReleasedRevisionId: 'revision-1',
          },
        },
      ]);
      tx.workOrder.create.mockResolvedValue(workOrder);

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
        engineeringRevisionIds: ['revision-1'],
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
          engineeringRevisionPins: {
            create: Array<{
              engineeringRevisionId: string;
              companyId: string;
              pinnedById: string;
            }>;
          };
        };
      };

      const createCalls = tx.workOrder.create.mock.calls as unknown as Array<
        [CreateCall]
      >;
      const createCall = createCalls[0]?.[0];

      expect(result).toEqual(workOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'o1', companyId: 'c1' },
        include: { items: true },
      });
      expect(createCall.data.orderId).toBe('o1');
      expect(createCall.data.productId).toBe('p1');
      expect(createCall.data.plannedQty).toBe(100);
      expect(createCall.data.status).toBe('PENDING');
      expect(createCall.data.companyId).toBe('c1');
      expect(createCall.data.workOrderNo).toMatch(/^WO-/);
      expect(createCall.data.engineeringRevisionPins.create).toEqual([
        {
          engineeringRevisionId: 'revision-1',
          companyId: 'c1',
          pinnedById: 'sales-1',
        },
      ]);
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createWorkOrder('c1', {
          orderId: 'nonexistent',
          productId: 'p1',
          plannedQty: 100,
          engineeringRevisionIds: ['revision-1'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateWorkOrdersFromSalesOrder', () => {
    it('creates one work order per order product and moves order into production', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderNo: 'ORD-001',
        salesId: 'sales-1',
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
      prisma.engineeringDocumentRevision.findMany.mockResolvedValue([
        {
          id: 'revision-1',
          engineeringDocument: {
            productId: 'product-1',
            orderId: 'order-1',
            currentReleasedRevisionId: 'revision-1',
          },
        },
        {
          id: 'revision-2',
          engineeringDocument: {
            productId: 'product-2',
            orderId: 'order-1',
            currentReleasedRevisionId: 'revision-2',
          },
        },
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
        { engineeringRevisionIds: ['revision-1', 'revision-2'] },
      );

      expect(result.created).toHaveLength(2);
      const workOrderCreateCalls = tx.workOrder.create.mock.calls as Array<
        [
          {
            data: {
              productId: string;
              plannedQty: number;
              engineeringRevisionPins: {
                create: Array<{ engineeringRevisionId: string }>;
              };
            };
          },
        ]
      >;
      expect(workOrderCreateCalls[0]?.[0].data.productId).toBe('product-1');
      expect(workOrderCreateCalls[0]?.[0].data.plannedQty).toBe(5);
      expect(
        workOrderCreateCalls[0]?.[0].data.engineeringRevisionPins.create,
      ).toEqual([
        expect.objectContaining({ engineeringRevisionId: 'revision-1' }),
      ]);
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'IN_PRODUCTION' },
      });
    });

    it('rejects generation when default BOM is missing', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderNo: 'ORD-001',
        salesId: 'sales-1',
        status: 'SUBMITTED',
        items: [{ productId: 'product-1', quantity: 2 }],
        workOrders: [],
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'product-1', sku: 'P1', name: '产品1' },
      ]);
      prisma.bom.findMany.mockResolvedValue([]);

      await expect(
        service.generateWorkOrdersFromSalesOrder('c1', 'order-1', {
          engineeringRevisionIds: ['revision-1'],
        }),
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

  describe('getMaterialAvailability', () => {
    it('summarizes open work order BOM requirements against projected stock', async () => {
      prisma.workOrder.findMany.mockResolvedValue([
        {
          id: 'wo1',
          workOrderNo: 'WO-001',
          productId: 'product-1',
          plannedQty: 10,
          actualQty: 4,
          status: 'IN_PROGRESS',
          product: { id: 'product-1', sku: 'FG-1', name: '成品1' },
          order: { orderNo: 'SO-001', partner: { name: '客户A' } },
        },
      ]);
      prisma.bom.findFirst.mockResolvedValue({
        id: 'bom-1',
        lines: [{ materialId: 'raw-1', quantity: 2, scrapRate: 0.1 }],
      });
      prisma.material.findMany.mockResolvedValue([
        {
          id: 'raw-1',
          sku: 'RM-1',
          name: '原料1',
          category: '原料',
          unit: 'kg',
          unitPrice: 8,
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 'raw-1', quantity: 10 },
      ]);
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          materialId: 'raw-1',
          quantity: 12,
          receivedQty: 10,
          purchaseOrder: {
            id: 'po-1',
            purchaseNo: 'PO-001',
            status: 'ORDERED',
            expectedDate: new Date('2026-06-20T00:00:00.000Z'),
            supplier: { name: '供应商A' },
          },
        },
      ]);

      const result = await service.getMaterialAvailability('c1');

      expect(result.shortageCount).toBe(1);
      expect(result.rows).toEqual([
        expect.objectContaining({
          materialId: 'raw-1',
          sku: 'RM-1',
          requiredQty: 13.2,
          onHandQty: 10,
          incomingQty: 2,
          projectedQty: 12,
          shortageQty: 1.2,
          suggestedPurchaseQty: 1.2,
          unitPrice: 8,
          estimatedAmount: 9.6,
          coveragePct: 90.91,
          status: 'SHORTAGE',
          incomingSources: [
            {
              purchaseOrderId: 'po-1',
              purchaseNo: 'PO-001',
              supplierName: '供应商A',
              status: 'ORDERED',
              expectedDate: '2026-06-20T00:00:00.000Z',
              orderedQty: 12,
              receivedQty: 10,
              incomingQty: 2,
            },
          ],
        }),
      ]);
      expect(result.rows[0]?.affectedWorkOrders).toEqual([
        expect.objectContaining({
          workOrderNo: 'WO-001',
          openQty: 6,
          requiredQty: 13.2,
          customerName: '客户A',
        }),
      ]);
      expect(prisma.stockQuant.findMany).toHaveBeenCalledWith({
        where: {
          materialId: { in: ['raw-1'] },
          location: {
            companyId: 'c1',
            usage: 'INTERNAL',
            isActive: true,
          },
        },
        select: {
          materialId: true,
          quantity: true,
        },
      });
      expect(prisma.purchaseOrderLine.findMany).toHaveBeenCalledWith({
        where: {
          materialId: { in: ['raw-1'] },
          purchaseOrder: {
            companyId: 'c1',
            status: { in: ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'] },
          },
        },
        select: {
          materialId: true,
          quantity: true,
          receivedQty: true,
          purchaseOrder: {
            select: {
              id: true,
              purchaseNo: true,
              status: true,
              expectedDate: true,
              supplier: { select: { name: true } },
            },
          },
        },
      });
    });

    it('keeps missing BOM work orders visible instead of failing the whole report', async () => {
      prisma.workOrder.findMany.mockResolvedValue([
        {
          id: 'wo-missing',
          workOrderNo: 'WO-MISSING',
          productId: 'product-missing',
          plannedQty: 5,
          actualQty: 0,
          status: 'PENDING',
          product: {
            id: 'product-missing',
            sku: 'FG-M',
            name: '缺BOM成品',
          },
          order: null,
        },
      ]);
      prisma.bom.findFirst.mockResolvedValue(null);

      const result = await service.getMaterialAvailability('c1');

      expect(result.rows).toEqual([]);
      expect(result.missingBomWorkOrders).toEqual([
        expect.objectContaining({
          workOrderNo: 'WO-MISSING',
          productSku: 'FG-M',
          openQty: 5,
          reason: '产品未配置默认 BOM，无法按报工扣减原料',
        }),
      ]);
      expect(prisma.material.findMany).not.toHaveBeenCalled();
      expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
      expect(prisma.purchaseOrderLine.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createPurchaseOrderFromShortages', () => {
    it('creates a purchase order from selected shortage rows', async () => {
      const availability = {
        rows: [
          {
            materialId: 'raw-1',
            sku: 'RM-1',
            name: '原料1',
            category: '原料',
            unit: 'kg',
            requiredQty: 13.2,
            onHandQty: 10,
            incomingQty: 2,
            projectedQty: 12,
            shortageQty: 1.2,
            suggestedPurchaseQty: 1.2,
            unitPrice: 8,
            estimatedAmount: 9.6,
            coveragePct: 90.91,
            status: 'SHORTAGE' as const,
            affectedWorkOrders: [],
            incomingSources: [],
          },
          {
            materialId: 'raw-2',
            sku: 'RM-2',
            name: '原料2',
            category: '原料',
            unit: 'pcs',
            requiredQty: 4,
            onHandQty: 4,
            incomingQty: 0,
            projectedQty: 4,
            shortageQty: 0,
            suggestedPurchaseQty: 0,
            unitPrice: 2,
            estimatedAmount: 0,
            coveragePct: 100,
            status: 'AVAILABLE' as const,
            affectedWorkOrders: [],
            incomingSources: [],
          },
        ],
        shortageCount: 1,
        totalOpenWorkOrders: 1,
        missingBomWorkOrders: [],
      };
      jest
        .spyOn(service, 'getMaterialAvailability')
        .mockResolvedValue(availability);
      purchaseService.createPurchaseOrder.mockResolvedValue({ id: 'po-1' });

      const result = await service.createPurchaseOrderFromShortages(
        'c1',
        'u1',
        {
          supplierId: 'supplier-1',
          materialIds: ['raw-1'],
          expectedDate: '2026-06-20',
        },
      );

      expect(result).toEqual({ id: 'po-1' });
      expect(purchaseService.createPurchaseOrder).toHaveBeenCalledWith(
        'c1',
        'u1',
        {
          supplierId: 'supplier-1',
          expectedDate: '2026-06-20',
          notes: '按生产物料短缺自动生成，涉及 1 个物料',
          items: [
            {
              materialId: 'raw-1',
              quantity: 1.2,
              unitPrice: 8,
              note: '生产缺料：需求 13.2，现存 10，在途 2，缺口 1.2',
            },
          ],
        },
      );
    });

    it('rejects purchase order creation when there is no current shortage', async () => {
      jest.spyOn(service, 'getMaterialAvailability').mockResolvedValue({
        rows: [],
        shortageCount: 0,
        totalOpenWorkOrders: 0,
        missingBomWorkOrders: [],
      });

      await expect(
        service.createPurchaseOrderFromShortages('c1', 'u1', {
          supplierId: 'supplier-1',
        }),
      ).rejects.toThrow('当前没有可生成采购单的生产物料短缺');
      expect(purchaseService.createPurchaseOrder).not.toHaveBeenCalled();
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
