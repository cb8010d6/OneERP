/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

type MockPrisma = {
  product: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  taxCode: {
    findFirst: jest.Mock;
  };
  order: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  stockQuant: {
    findMany: jest.Mock;
  };
  inventoryTransaction: { findMany: jest.Mock };
  inventoryReturnDocument: { findMany: jest.Mock };
};

describe('OrdersService', () => {
  const prisma: MockPrisma = {
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    taxCode: {
      findFirst: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    stockQuant: {
      findMany: jest.fn(),
    },
    inventoryTransaction: { findMany: jest.fn() },
    inventoryReturnDocument: { findMany: jest.fn() },
  };

  const eventQueueService = {
    publish: jest.fn(),
  };

  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.inventoryReturnDocument.findMany.mockResolvedValue([]);
    service = new OrdersService(
      prisma as unknown as ConstructorParameters<typeof OrdersService>[0],
      eventQueueService as unknown as ConstructorParameters<
        typeof OrdersService
      >[1],
    );
  });

  it('uses database price instead of payload price and marks large discounts for approval', async () => {
    prisma.taxCode.findFirst.mockResolvedValue({
      id: 'tax-1',
      rate: 0.1,
      isTaxInclusive: false,
    });
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'Apple Phone',
      sku: 'SKU-001',
      listPrice: 80,
    });
    prisma.order.create.mockResolvedValue({
      id: 'order-1',
      partnerId: 'partner-1',
      status: 'PENDING_APPROVAL',
      items: [{ id: 'item-1' }],
    });
    eventQueueService.publish.mockResolvedValue(undefined);

    const result = (await service.createOrder('company-1', 'user-1', {
      partnerId: 'partner-1',
      taxCodeId: 'tax-1',
      items: [
        {
          productId: 'prod-1',
          quantity: 2,
          unitPrice: 999,
          requestedDiscount: 15,
        } as unknown as {
          productId: string;
          quantity: number;
          requestedDiscount: number;
        },
      ],
    })) as { status: string };

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'prod-1', companyId: 'company-1' },
      select: {
        id: true,
        name: true,
        sku: true,
        listPrice: true,
      },
    });
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_APPROVAL',
          totalAmount: 149.6,
          subTotal: 136,
          taxTotal: 13.6,
          items: {
            create: [
              expect.objectContaining({
                productId: 'prod-1',
                quantity: 2,
                unitPrice: 80,
                subTotal: 136,
                taxAmount: 13.6,
                totalPrice: 149.6,
                customAttributes: {
                  requestedDiscount: 15,
                  discountRate: 0.15,
                  discountAmount: 24,
                },
              }),
            ],
          },
        }),
        include: {
          items: true,
          partner: true,
        },
      }),
    );
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(eventQueueService.publish).toHaveBeenCalled();
  });

  it('summarizes order fulfillment availability from stock and open work orders', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNo: 'ORD-001',
      status: 'IN_PRODUCTION',
      expectedDate: new Date('2026-06-20T00:00:00.000Z'),
      items: [{ id: 'item-1', productId: 'prod-1', quantity: 10 }],
      workOrders: [
        {
          productId: 'prod-1',
          plannedQty: 8,
          actualQty: 2,
        },
      ],
    });
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        sku: 'FG-1',
        name: '成品1',
        materialId: 'mat-fg-1',
      },
    ]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { materialId: 'mat-fg-1', quantity: 5 },
    ]);

    const result = await service.getOrderFulfillmentAvailability(
      'order-1',
      'company-1',
    );

    expect(result).toMatchObject({
      orderId: 'order-1',
      orderNo: 'ORD-001',
      status: 'IN_PRODUCTION',
      expectedDate: '2026-06-20T00:00:00.000Z',
      overallStatus: 'COVERED_BY_PRODUCTION',
      lines: [
        {
          orderItemId: 'item-1',
          productId: 'prod-1',
          productSku: 'FG-1',
          productName: '成品1',
          materialId: 'mat-fg-1',
          orderedQty: 10,
          onHandQty: 5,
          inProductionQty: 6,
          projectedQty: 11,
          shortageQty: 0,
          status: 'COVERED_BY_PRODUCTION',
        },
      ],
    });
    expect(prisma.stockQuant.findMany).toHaveBeenCalledWith({
      where: {
        materialId: { in: ['mat-fg-1'] },
        location: {
          companyId: 'company-1',
          usage: 'INTERNAL',
          isActive: true,
        },
      },
      select: {
        materialId: true,
        quantity: true,
      },
    });
  });

  it('marks fulfillment availability as unmapped when product has no finished material', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-2',
      orderNo: 'ORD-002',
      status: 'PENDING',
      expectedDate: null,
      items: [{ id: 'item-2', productId: 'prod-2', quantity: 3 }],
      workOrders: [],
    });
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-2',
        sku: 'FG-2',
        name: '未映射成品',
        materialId: null,
      },
    ]);

    const result = await service.getOrderFulfillmentAvailability(
      'order-2',
      'company-1',
    );

    expect(result.overallStatus).toBe('UNMAPPED');
    expect(result.lines[0]).toEqual(
      expect.objectContaining({
        productId: 'prod-2',
        materialId: null,
        orderedQty: 3,
        shortageQty: 3,
        status: 'UNMAPPED',
      }),
    );
    expect(prisma.stockQuant.findMany).not.toHaveBeenCalled();
  });

  it('adds fulfillment summary to order list rows', async () => {
    prisma.order.findMany = jest.fn().mockResolvedValue([
      {
        id: 'order-list-1',
        orderNo: 'ORD-LIST-1',
        status: 'PENDING',
        items: [{ id: 'item-list-1', productId: 'prod-list-1', quantity: 6 }],
        workOrders: [],
        partner: { name: '客户A' },
        salesPerson: { id: 'user-1', name: '销售A' },
      },
    ]);
    prisma.order.count = jest.fn().mockResolvedValue(1);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-list-1',
        sku: 'FG-L1',
        name: '列表成品',
        materialId: 'mat-list-1',
      },
    ]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { materialId: 'mat-list-1', quantity: 2 },
    ]);

    const result = await service.getOrdersByCompany('company-1', {
      page: 1,
      limit: 20,
    });

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'order-list-1',
        fulfillmentSummary: {
          overallStatus: 'SHORTAGE',
          lineCount: 1,
          shortageLineCount: 1,
          unmappedLineCount: 0,
          totalShortageQty: 4,
        },
      }),
    );
  });

  it('batches tenant evidence and returns the same material assessment in list and detail', async () => {
    const order = {
      id: 'o1',
      orderNo: 'ORD',
      status: 'PENDING',
      expectedDate: null,
      items: [
        { id: 'i1', productId: 'p1', quantity: 10 },
        { id: 'i2', productId: 'p1', quantity: 5 },
      ],
      workOrders: [],
    };
    prisma.order.findMany.mockResolvedValue([
      order,
      { ...order, id: 'o2', orderNo: 'ORD-2' },
    ]);
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.order.count.mockResolvedValue(2);
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', sku: 'P', name: 'Product', materialId: 'm1' },
    ]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: 5 },
    ]);
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        id: 's1',
        companyId: 'c1',
        materialId: 'm1',
        type: 'OUTBOUND',
        referenceNo: 'SALE-SHIP-ORD',
        quantity: 10,
      },
      {
        id: 'r2',
        companyId: 'c1',
        materialId: 'm1',
        type: 'INBOUND',
        referenceNo: 'SALE-SHIP-REV-ORD-2',
        quantity: 1,
      },
    ]);
    prisma.inventoryReturnDocument.findMany.mockResolvedValue([
      { sourceDocumentId: 'o2', lines: [{ inventoryMoveId: 'r2' }] },
    ]);
    const list = await service.getOrdersByCompany('c1', { page: 1, limit: 20 });
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.stockQuant.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryReturnDocument.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1'] }, companyId: 'c1', isActive: true },
      }),
    );
    expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'c1' }),
      }),
    );
    expect(prisma.inventoryReturnDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'c1',
          returnType: 'SALES',
          status: 'POSTED',
          lines: { some: { inventoryMoveId: { in: ['r2'] } } },
        },
      }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          workOrders: expect.objectContaining({
            where: {
              companyId: 'c1',
              status: { in: ['PENDING', 'IN_PROGRESS'] },
            },
          }),
        }),
      }),
    );
    const detail = await service.getOrderFulfillmentAvailability('o1', 'c1');
    expect(detail.fulfillmentEvidence).toEqual(
      list.data[0].fulfillmentEvidence,
    );
    expect(detail.fulfillmentEvidence).toMatchObject({
      assessment: 'ON_HAND_COVERAGE',
      materialDemandGroups: [
        { orderedQty: 15, netShippedQty: 10, remainingQty: 5, onHandQty: 5 },
      ],
    });
  });

  it('does not hide invalid raw stock behind a valid aggregate', async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      orderNo: 'ORD',
      status: 'PENDING',
      expectedDate: null,
      items: [{ id: 'i1', productId: 'p1', quantity: 2 }],
      workOrders: [],
    });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', sku: 'P', name: 'Product', materialId: 'm1' },
    ]);
    prisma.stockQuant.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: -1 },
      { materialId: 'm1', quantity: 10 },
    ]);
    const detail = await service.getOrderFulfillmentAvailability('o1', 'c1');
    expect(detail.fulfillmentEvidence).toMatchObject({
      assessment: 'DATA_REVIEW',
      materialDemandGroups: [{ onHandQty: null, remainingQty: null }],
    });
    expect(detail.overallStatus).toBe('UNMAPPED');
  });

  it('keeps draft status when discount is at most 10%', async () => {
    prisma.taxCode.findFirst.mockResolvedValue({
      id: 'tax-1',
      rate: 0,
      isTaxInclusive: false,
    });
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-2',
      name: 'Standard Widget',
      sku: 'SKU-002',
      listPrice: 100,
    });
    prisma.order.create.mockResolvedValue({
      id: 'order-2',
      partnerId: 'partner-1',
      status: 'DRAFT',
      items: [{ id: 'item-2' }],
    });
    eventQueueService.publish.mockResolvedValue(undefined);

    const result = (await service.createOrder('company-1', 'user-1', {
      partnerId: 'partner-1',
      taxCodeId: 'tax-1',
      items: [
        {
          productId: 'prod-2',
          quantity: 1,
          requestedDiscount: 10,
        },
      ],
    })) as { status: string };

    expect(result.status).toBe('DRAFT');
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DRAFT',
        }),
      }),
    );
  });

  it('throws when product is missing a material price', async () => {
    prisma.taxCode.findFirst.mockResolvedValue({
      id: 'tax-1',
      rate: 0,
      isTaxInclusive: false,
    });
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-3',
      name: 'Broken Product',
      sku: 'SKU-003',
      listPrice: 0,
    });

    await expect(
      service.createOrder('company-1', 'user-1', {
        partnerId: 'partner-1',
        taxCodeId: 'tax-1',
        items: [
          {
            productId: 'prod-3',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
