import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  CreatePurchaseOrderDto,
  ReceivePurchaseItemDto,
  UpdatePurchaseOrderStatusDto,
} from './dto/purchase.dto';

@Injectable()
export class PurchaseService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  /**
   * 创建采购订单
   */
  async createPurchaseOrder(companyId: string, data: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.partner.findFirst({
      where: {
        id: data.supplierId,
        companyId,
        type: { in: ['SUPPLIER', 'BOTH'] },
      },
    });
    if (!supplier) throw new NotFoundException('供应商不存在或无权限访问');

    const materialIds = data.items.map((i) => i.materialId);
    const materials = await this.prisma.material.findMany({
      where: {
        id: { in: materialIds },
        OR: [{ companyId }, { companyId: null }],
      },
    });
    if (materials.length !== materialIds.length) {
      throw new BadRequestException('部分物料不存在');
    }

    let totalAmount = 0;
    for (const item of data.items)
      totalAmount += item.quantity * item.unitPrice;

    const now = new Date();
    const orderNo = `PO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    return this.prisma.purchaseOrder.create({
      data: {
        orderNo,
        partnerId: data.supplierId,
        companyId,
        status: 'CONFIRMED',
        totalAmount,
        notes: data.notes,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        lines: {
          create: data.items.map((item) => ({
            materialId: item.materialId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            companyId,
            description: item.note,
          })),
        },
      },
      include: { partner: true, lines: { include: { material: true } } },
    });
  }

  /**
   * 获取采购订单列表
   */
  async getPurchaseOrders(
    companyId: string,
    pagination: PaginationDto,
    status?: string,
    search?: string,
  ) {
    const { page = 1, limit = 20 } = pagination;
    const where: Prisma.PurchaseOrderWhereInput = { companyId };
    if (status && status in PurchaseOrderStatus) {
      where.status = status as PurchaseOrderStatus;
    }
    if (search) {
      where.OR = [
        { orderNo: { contains: search, mode: 'insensitive' } },
        { partner: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { partner: true, lines: { include: { material: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * 获取采购订单详情（包含可收货数量）
   */
  async getPurchaseOrderById(orderId: string, companyId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
      include: { partner: true, lines: { include: { material: true } } },
    });
    if (!order) throw new NotFoundException('采购订单不存在或无权限访问');

    const itemsWithRemaining = order.lines.map((item) => ({
      ...item,
      remainingQty: Math.max(0, item.quantity - item.receivedQuantity),
    }));

    return { ...order, items: itemsWithRemaining };
  }

  /**
   * 更新采购订单状态
   */
  async updatePurchaseOrderStatus(
    orderId: string,
    companyId: string,
    data: UpdatePurchaseOrderStatusDto,
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
    });
    if (!order) throw new NotFoundException('采购订单不存在或无权限访问');
    if (order.status === 'CANCELLED')
      throw new BadRequestException('已取消的采购单不能更新状态');
    if (order.status === 'RECEIVED' && data.status !== 'CANCELLED') {
      throw new BadRequestException('已完成收货的采购单不能更改状态');
    }

    return this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: data.status as PurchaseOrderStatus },
      include: { partner: true, lines: { include: { material: true } } },
    });
  }

  /**
   * 采购收货执行 - 核心逻辑
   * 验证数量不超过可收货数量，调用库存服务创建入库记录
   */
  async receivePurchaseItem(
    companyId: string,
    data: ReceivePurchaseItemDto,
    operatorId: string,
  ) {
    // 1. 验证采购单存在且状态正确
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: data.purchaseOrderId, companyId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('采购订单不存在或无权限访问');
    if (order.status === 'CANCELLED')
      throw new BadRequestException('已取消的采购单不能收货');
    if (order.status === 'RECEIVED')
      throw new BadRequestException('采购单已全部收货完成');

    // 2. 验证采购单明细存在
    const orderItem = order.lines.find((item) => item.id === data.itemId);
    if (!orderItem) throw new NotFoundException('采购单明细不存在');

    // 3. 验证收货数量不超过可收货数量
    const remainingQty = orderItem.quantity - orderItem.receivedQuantity;
    if (remainingQty <= 0)
      throw new BadRequestException('该明细已全部收货完成');
    if (data.quantity > remainingQty) {
      throw new BadRequestException(
        `收货数量(${data.quantity})超过可收货数量(${remainingQty})`,
      );
    }

    // 4. 验证目标库位存在
    const location = await this.prisma.stockLocation.findFirst({
      where: { id: data.destLocationId, companyId },
    });
    if (!location) throw new NotFoundException('目标库位不存在或无权限访问');

    // 5. 执行收货入库（在事务中完成）
    const result = await this.prisma.$transaction(async (tx) => {
      const referenceNo = `PURCHASE-RECV-${order.orderNo}`;
      const inventoryTransaction = await this.inventoryService.createStockMove(
        companyId,
        {
          materialId: orderItem.materialId!,
          destLocationId: data.destLocationId,
          quantity: data.quantity,
          batchNo: data.batchNo,
          referenceNo,
          documentType: 'PURCHASE_RECEIPT',
          documentId: order.id,
          note: data.note ?? `采购收货入库：${order.orderNo}`,
        },
        operatorId,
      );

      const newReceivedQty = orderItem.receivedQuantity + data.quantity;
      await tx.purchaseOrderLine.update({
        where: { id: orderItem.id },
        data: { receivedQuantity: newReceivedQty },
      });

      const allItems = await tx.purchaseOrderLine.findMany({
        where: { orderId: order.id },
      });
      const allReceived = allItems.every(
        (item) => item.receivedQuantity >= item.quantity,
      );
      const anyReceived = allItems.some((item) => item.receivedQuantity > 0);

      let newStatus = order.status;
      if (allReceived) newStatus = PurchaseOrderStatus.RECEIVED;
      else if (anyReceived) newStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: newStatus },
      });

      return {
        transactionId: inventoryTransaction.id,
        purchaseOrderNo: order.orderNo,
        receivedQuantity: data.quantity,
        newReceivedQty,
        remainingQty: orderItem.quantity - newReceivedQty,
        newOrderStatus: newStatus,
        message: allReceived
          ? '收货完成，采购单已全部收货'
          : `收货成功，剩余可收货数量：${orderItem.quantity - newReceivedQty}`,
      };
    });

    return result;
  }

  /**
   * 扫码收货 - 通过物料条码自动匹配最近的采购单明细
   */
  async scanReceive(
    companyId: string,
    data: {
      materialSku: string;
      quantity: number;
      destLocationId: string;
      batchNo?: string;
    },
    operatorId: string,
  ) {
    const material = await this.prisma.material.findUnique({
      where: { sku: data.materialSku },
    });
    if (!material) throw new NotFoundException('未找到对应条码的物料');

    const orderItem = await this.prisma.purchaseOrderLine.findFirst({
      where: {
        materialId: material.id,
        order: {
          companyId,
          status: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] },
        },
      },
      include: { order: true },
      orderBy: { order: { createdAt: 'desc' } },
    });
    if (!orderItem) throw new BadRequestException('未找到该物料的待收货采购单');

    const remainingQty = orderItem.quantity - orderItem.receivedQuantity;
    if (remainingQty <= 0)
      throw new BadRequestException('该采购明细已全部收货');

    const receiveQty = Math.min(data.quantity, remainingQty);

    return this.receivePurchaseItem(
      companyId,
      {
        purchaseOrderId: orderItem.orderId,
        itemId: orderItem.id,
        quantity: receiveQty,
        destLocationId: data.destLocationId,
        batchNo: data.batchNo,
      },
      operatorId,
    );
  }

  /**
   * 获取待收货的采购单列表（供前端选择）
   */
  async getPendingReceivableOrders(companyId: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { companyId, status: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] } },
      include: {
        partner: true,
        lines: { include: { material: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders
      .map((order) => {
        const items = order.lines.filter(
          (item) => item.receivedQuantity < item.quantity,
        );
        return { ...order, items };
      })
      .filter((order) => order.items.length > 0);
  }
}
