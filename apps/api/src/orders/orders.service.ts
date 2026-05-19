import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { EventQueueService } from '../core/events/event-queue.service';
import { roundDecimal } from '../core/utils/decimal';

interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  requestedDiscount?: number;
  taxCodeId?: string;
}

interface CreateOrderInput {
  partnerId: string;
  items?: CreateOrderItemInput[];
  taxCodeId?: string;
  aiSummary?: Prisma.InputJsonValue;
  expectedDate?: string | Date | null;
  notes?: string | null;
}

interface UpdateOrderHeaderInput {
  partnerId?: string;
  expectedDate?: string | Date | null;
  notes?: string | null;
}

interface PreparedOrderItemsResult {
  orderItems: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    subTotal: number;
    taxAmount: number;
    taxRate: number;
    taxCodeId: string | null;
    customAttributes?: Prisma.InputJsonValue;
  }>;
  totalAmount: number;
  subTotal: number;
  taxTotal: number;
  approvalRequired: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  private round2(value: number) {
    return roundDecimal(value);
  }

  private normalizeDiscountRate(requestedDiscount?: number) {
    if (requestedDiscount === undefined || requestedDiscount === null) {
      return 0;
    }

    const numericDiscount = Number(requestedDiscount);
    if (!Number.isFinite(numericDiscount) || numericDiscount < 0) {
      throw new BadRequestException('折扣格式不正确');
    }

    if (numericDiscount > 100) {
      throw new BadRequestException('折扣不能超过 100%');
    }

    return numericDiscount > 1 ? numericDiscount / 100 : numericDiscount;
  }

  private async resolveProductPrice(companyId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        name: true,
        sku: true,
        listPrice: true,
      },
    });

    if (!product) {
      throw new BadRequestException(`产品不存在或无权访问：${productId}`);
    }

    const salePrice = this.round2(Number(product.listPrice ?? 0));
    if (salePrice <= 0) {
      throw new BadRequestException(
        `产品 ${product.name} 未配置销售价，无法创建订单`,
      );
    }

    return {
      product,
      baseUnitPrice: salePrice,
    };
  }

  private assertOrderEditable(status: string) {
    if (!['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED'].includes(status)) {
      throw new BadRequestException(
        `当前单据状态为 ${status}，仅 DRAFT/PENDING_APPROVAL/SUBMITTED 状态允许修改`,
      );
    }
  }

  private async buildOrderItems(
    companyId: string,
    items: CreateOrderItemInput[],
    taxCodeId?: string | null,
  ): Promise<PreparedOrderItemsResult> {
    let totalAmount = 0;
    let subTotal = 0;
    let taxTotal = 0;
    let approvalRequired = false;

    const baseTaxCode = await this.resolveTaxCode(companyId, taxCodeId);
    const orderItems = await Promise.all(
      items.map(async (item) => {
        const { baseUnitPrice } = await this.resolveProductPrice(
          companyId,
          item.productId,
        );

        const resolvedTaxCode = item.taxCodeId
          ? await this.resolveTaxCode(companyId, item.taxCodeId)
          : baseTaxCode;

        const discountRate = this.normalizeDiscountRate(item.requestedDiscount);
        if (discountRate > 0.1) {
          approvalRequired = true;
        }

        const lineBase = this.round2(item.quantity * baseUnitPrice);
        const discountAmount = this.round2(lineBase * discountRate);
        const discountedBase = this.round2(lineBase - discountAmount);
        const breakdown = this.calcTaxBreakdown(
          discountedBase,
          Number(resolvedTaxCode.rate ?? 0),
          resolvedTaxCode.isTaxInclusive,
        );

        totalAmount += breakdown.total;
        subTotal += breakdown.subTotal;
        taxTotal += breakdown.taxAmount;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: baseUnitPrice,
          totalPrice: breakdown.total,
          subTotal: breakdown.subTotal,
          taxAmount: breakdown.taxAmount,
          taxRate: Number(resolvedTaxCode.rate ?? 0),
          taxCodeId: resolvedTaxCode.id ?? null,
          customAttributes:
            discountRate > 0
              ? {
                  requestedDiscount: item.requestedDiscount,
                  discountRate,
                  discountAmount,
                }
              : undefined,
        };
      }),
    );

    return {
      orderItems,
      totalAmount: this.round2(totalAmount),
      subTotal: this.round2(subTotal),
      taxTotal: this.round2(taxTotal),
      approvalRequired,
    };
  }

  private calcTaxBreakdown(
    baseAmount: number,
    taxRate: number,
    isTaxInclusive: boolean,
  ) {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));
    if (isTaxInclusive) {
      const subTotal = this.round2(baseAmount / (1 + safeRate));
      const taxAmount = this.round2(baseAmount - subTotal);
      return {
        subTotal,
        taxAmount,
        total: this.round2(baseAmount),
      };
    }

    const subTotal = this.round2(baseAmount);
    const taxAmount = this.round2(subTotal * safeRate);
    const total = this.round2(subTotal + taxAmount);
    return { subTotal, taxAmount, total };
  }

  private async resolveTaxCode(companyId: string, taxCodeId?: string | null) {
    if (taxCodeId) {
      const taxCode = await this.prisma.taxCode.findFirst({
        where: { id: taxCodeId, companyId, active: true },
      });
      if (!taxCode) {
        throw new BadRequestException('税码不存在或已停用，请确认税码选择');
      }
      return { ...taxCode, isFallback: false };
    }

    const defaultTaxCode = await this.prisma.taxCode.findFirst({
      where: { companyId, isDefault: true, active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (defaultTaxCode) {
      return { ...defaultTaxCode, isFallback: false };
    }

    this.logger.warn(
      `未配置默认税码，订单将使用 13% 默认税率: companyId=${companyId}`,
    );
    return {
      id: null,
      rate: 0.13,
      isTaxInclusive: true,
      isFallback: true,
    };
  }

  async createOrder(companyId: string, userId: string, data: CreateOrderInput) {
    const { partnerId, items, aiSummary, expectedDate, notes, taxCodeId } =
      data;

    // 自动生成订单号
    const orderNo = `ORD-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (!items?.length) {
      throw new BadRequestException('订单明细不能为空');
    }

    const baseTaxCode = await this.resolveTaxCode(companyId, taxCodeId);
    const { orderItems, totalAmount, subTotal, taxTotal, approvalRequired } =
      await this.buildOrderItems(companyId, items, taxCodeId);

    const created = await this.prisma.order.create({
      data: {
        orderNo,
        companyId,
        salesId: userId,
        partnerId,
        status: approvalRequired ? 'PENDING_APPROVAL' : 'DRAFT',
        totalAmount,
        subTotal: this.round2(subTotal),
        taxTotal: this.round2(taxTotal),
        taxCodeId: baseTaxCode.id ?? null,
        aiSummary,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: true,
        partner: true,
      },
    });

    await this.eventQueueService.publish({
      eventName: 'order.created',
      idempotencyKey: `order_created:${created.id}`,
      companyId,
      payload: {
        orderId: created.id,
        companyId,
        operatorId: userId,
        status: created.status,
        items: created.items,
        partnerId: created.partnerId,
      },
      maxAttempts: 5,
    });

    return created;
  }

  async updateOrder(
    companyId: string,
    orderId: string,
    data: UpdateOrderHeaderInput,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: {
        id: true,
        status: true,
        partnerId: true,
        expectedDate: true,
        notes: true,
      },
    });

    if (!order) {
      throw new NotFoundException('该订单不存在或您无权修改');
    }

    this.assertOrderEditable(order.status);

    const hasChanges =
      data.partnerId !== undefined ||
      data.expectedDate !== undefined ||
      data.notes !== undefined;

    if (!hasChanges) {
      throw new BadRequestException('没有可更新的订单字段');
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...(data.partnerId !== undefined ? { partnerId: data.partnerId } : {}),
        ...(data.expectedDate !== undefined
          ? {
              expectedDate: data.expectedDate
                ? new Date(data.expectedDate)
                : null,
            }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: {
        items: true,
        partner: true,
      },
    });

    return updated;
  }

  async updateOrderItems(
    companyId: string,
    orderId: string,
    data: { items?: CreateOrderItemInput[] },
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: {
        id: true,
        status: true,
        taxCodeId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('该订单不存在或您无权修改');
    }

    this.assertOrderEditable(order.status);

    if (!data.items?.length) {
      throw new BadRequestException('订单明细不能为空');
    }

    const { orderItems, totalAmount, subTotal, taxTotal, approvalRequired } =
      await this.buildOrderItems(companyId, data.items, order.taxCodeId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId } });

      for (const orderItem of orderItems) {
        await tx.orderItem.create({
          data: {
            ...orderItem,
            orderId,
          },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount,
          subTotal,
          taxTotal,
          status:
            approvalRequired || order.status === 'PENDING_APPROVAL'
              ? 'PENDING_APPROVAL'
              : order.status,
        },
      });

      return tx.order.findFirst({
        where: { id: orderId, companyId },
        include: {
          items: true,
          partner: true,
          salesPerson: { select: { id: true, name: true } },
        },
      });
    });

    if (!updated) {
      throw new NotFoundException('该订单不存在或您无权修改');
    }

    return updated;
  }

  async getOrdersByCompany(
    companyId: string,
    pagination: PaginationDto,
    search?: string,
    status?: string,
  ) {
    const { page = 1, limit = 20 } = pagination;
    const where: Prisma.OrderWhereInput = { companyId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { orderNo: { contains: search, mode: 'insensitive' } },
        { partner: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          partner: true,
          salesPerson: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getOrderById(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: {
        items: true,
        partner: true,
        salesPerson: { select: { id: true, name: true } },
        workOrders: {
          include: { reports: true },
        },
        invoices: {
          include: { payments: true },
        },
      },
    });
    if (!order) throw new NotFoundException('该订单不存在或您无权查看');
    return order;
  }

  async deleteOrder(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
    });
    if (!order) throw new NotFoundException('订单不存在或无权操作');
    if (order.status !== 'DRAFT')
      throw new BadRequestException('只能删除草稿状态的订单');

    await this.prisma.orderItem.deleteMany({ where: { orderId } });
    return this.prisma.order.delete({ where: { id: orderId } });
  }

  async getOrderTimeline(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, orderNo: true },
    });

    if (!order) {
      throw new NotFoundException('该订单不存在或您无权查看');
    }

    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: { in: ['order', 'sale_order'] },
        entityId: orderId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 50,
    });

    return {
      orderId,
      orderNo: order.orderNo,
      events: logs.map((item) => ({
        id: item.id,
        action: item.action,
        createdAt: item.createdAt,
        user: item.user,
        details: item.details,
      })),
    };
  }
}
