import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

type MockPrisma = {
  product: {
    findFirst: jest.Mock;
  };
  taxCode: {
    findFirst: jest.Mock;
  };
  order: {
    create: jest.Mock;
  };
};

describe('OrdersService', () => {
  const prisma: MockPrisma = {
    product: {
      findFirst: jest.fn(),
    },
    taxCode: {
      findFirst: jest.fn(),
    },
    order: {
      create: jest.fn(),
    },
  };

  const eventQueueService = {
    publish: jest.fn(),
  };

  let service: OrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrdersService(
      prisma as unknown as ConstructorParameters<typeof OrdersService>[0],
      eventQueueService as unknown as ConstructorParameters<typeof OrdersService>[1],
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
      material: {
        id: 'mat-1',
        unitPrice: 80,
      },
    });
    prisma.order.create.mockResolvedValue({
      id: 'order-1',
      partnerId: 'partner-1',
      status: 'PENDING_APPROVAL',
      items: [{ id: 'item-1' }],
    });
    eventQueueService.publish.mockResolvedValue(undefined);

    const result = await service.createOrder('company-1', 'user-1', {
      partnerId: 'partner-1',
      taxCodeId: 'tax-1',
      items: [
        {
          productId: 'prod-1',
          quantity: 2,
          unitPrice: 999,
          requestedDiscount: 15,
        } as any,
      ],
    });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'prod-1', companyId: 'company-1' },
      select: {
        id: true,
        name: true,
        sku: true,
        material: {
          select: {
            id: true,
            unitPrice: true,
          },
        },
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
      material: {
        id: 'mat-2',
        unitPrice: 100,
      },
    });
    prisma.order.create.mockResolvedValue({
      id: 'order-2',
      partnerId: 'partner-1',
      status: 'DRAFT',
      items: [{ id: 'item-2' }],
    });
    eventQueueService.publish.mockResolvedValue(undefined);

    const result = await service.createOrder('company-1', 'user-1', {
      partnerId: 'partner-1',
      taxCodeId: 'tax-1',
      items: [
        {
          productId: 'prod-2',
          quantity: 1,
          requestedDiscount: 10,
        },
      ],
    });

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
      material: null,
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