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

interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
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

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
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
    const { partnerId, items, aiSummary, expectedDate, notes, taxCodeId } = data;

    // 自动生成订单号
    const orderNo = `ORD-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    let totalAmount = 0;
    let subTotal = 0;
    let taxTotal = 0;

    const baseTaxCode = await this.resolveTaxCode(companyId, taxCodeId);
    const orderItems = await Promise.all(
      (items ?? []).map(async (item) => {
        const resolvedTaxCode = item.taxCodeId
          ? await this.resolveTaxCode(companyId, item.taxCodeId)
          : baseTaxCode;

        const lineBase = item.quantity * item.unitPrice;
        const breakdown = this.calcTaxBreakdown(
          lineBase,
          resolvedTaxCode.rate,
          resolvedTaxCode.isTaxInclusive,
        );

        totalAmount += breakdown.total;
        subTotal += breakdown.subTotal;
        taxTotal += breakdown.taxAmount;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: breakdown.total,
          subTotal: breakdown.subTotal,
          taxAmount: breakdown.taxAmount,
          taxRate: Number(resolvedTaxCode.rate ?? 0),
          taxCodeId: resolvedTaxCode.id ?? null,
        };
      }),
    );

    const created = await this.prisma.order.create({
      data: {
        orderNo,
        companyId,
        salesId: userId,
        partnerId,
        status: 'DRAFT',
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
        items: created.items,
        partnerId: created.partnerId,
      },
      maxAttempts: 5,
    });

    return created;
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
