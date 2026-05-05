import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TaxNature, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TaxService } from "../core/tax/tax.service";
import { PaginationDto } from "../core/dto/pagination.dto";
import { EventQueueService } from "../core/events/event-queue.service";

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
    private readonly taxService: TaxService,
  ) {}

  async createOrder(companyId: string, userId: string, data: CreateOrderInput) {
    const { partnerId, items, aiSummary, expectedDate, notes, taxCodeId } = data;

    const orderNo = "ORD-" + new Date().getFullYear() + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + Math.floor(1000 + Math.random() * 9000);

    let totalAmount = 0;
    let subTotal = 0;
    let taxTotal = 0;

    const baseTaxCode = await this.taxService.resolveTaxCode(
      companyId,
      taxCodeId,
      { operatorId: userId, entity: "Order", entityId: "new" },
    );

    const orderItems = await Promise.all(
      (items ?? []).map(async (item) => {
        const resolvedTaxCode = item.taxCodeId
          ? await this.taxService.resolveTaxCode(companyId, item.taxCodeId)
          : baseTaxCode;

        const lineBase = item.quantity * item.unitPrice;
        const breakdown = this.taxService.calcTaxBreakdown(
          lineBase,
          resolvedTaxCode.rate,
          resolvedTaxCode.isTaxInclusive,
          resolvedTaxCode.taxNature,
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
          taxRate: breakdown.taxRate,
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
        status: "DRAFT",
        totalAmount,
        subTotal: this.taxService.round2(subTotal),
        taxTotal: this.taxService.round2(taxTotal),
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
      eventName: "order.created",
      idempotencyKey: "order_created:" + created.id,
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
        { orderNo: { contains: search, mode: "insensitive" } },
        { partner: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          partner: true,
          salesPerson: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
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
    if (!order) throw new NotFoundException("该订单不存在或您无权查看");
    return order;
  }

  async deleteOrder(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
    });
    if (!order) throw new NotFoundException("订单不存在或无权操作");
    if (order.status !== "DRAFT")
      throw new BadRequestException("只能删除草稿状态的订单");

    await this.prisma.orderItem.deleteMany({ where: { orderId } });
    return this.prisma.order.delete({ where: { id: orderId } });
  }

  async getOrderStockTransactions(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, orderNo: true },
    });

    if (!order) {
      throw new NotFoundException('该订单不存在或您无权查看');
    }

    // 库存过账时 referenceNo 格式: SALE-SHIP-{orderNo} 或 REVERSE-SHIP-{orderNo}
    const referencePatterns = [
      `SALE-SHIP-${order.orderNo}`,
      `REVERSE-SHIP-${order.orderNo}`,
      order.orderNo,
    ];

    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        referenceNo: { in: referencePatterns },
      },
      include: {
        material: { select: { id: true, sku: true, name: true, unit: true } },
        sourceLocation: {
          select: { id: true, name: true, code: true },
          include: { warehouse: { select: { id: true, name: true } } },
        },
        destLocation: {
          select: { id: true, name: true, code: true },
          include: { warehouse: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        materialId: tx.materialId,
        material: tx.material,
        quantity: tx.quantity,
        batchNo: tx.batchNo,
        referenceNo: tx.referenceNo,
        note: tx.note,
        sourceLocation: tx.sourceLocation,
        destLocation: tx.destLocation,
        createdAt: tx.createdAt,
      })),
    };
  }

  async getOrderTimeline(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, orderNo: true },
    });

    if (!order) {
      throw new NotFoundException("该订单不存在或您无权查看");
    }

    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: { in: ["order", "sale_order"] },
        entityId: orderId,
      },
      orderBy: { createdAt: "desc" },
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