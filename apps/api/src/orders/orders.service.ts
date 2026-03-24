import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { EventQueueService } from '../core/events/event-queue.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async createOrder(companyId: string, userId: string, data: any) {
    const { partnerId, items, aiSummary, expectedDate, notes } = data;

    // 自动生成订单号
    const orderNo = `ORD-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    let totalAmount = 0;
    const orderItems = (items || []).map((item: any) => {
      const totalPrice = item.quantity * item.unitPrice;
      totalAmount += totalPrice;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice,
      };
    });

    const created = await this.prisma.order.create({
      data: {
        orderNo,
        companyId,
        salesId: userId,
        partnerId,
        status: 'DRAFT',
        totalAmount,
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
    const where: any = { companyId };
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
