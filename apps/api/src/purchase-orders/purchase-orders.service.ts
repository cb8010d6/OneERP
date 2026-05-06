import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  CreatePurchaseOrderDto,
  AddPurchaseOrderLineDto,
} from './dto/create-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private calcLineAmounts(
    quantity: number,
    unitPrice: number,
    taxRate: number,
  ) {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));
    const subTotal = this.round2(quantity * unitPrice);
    const taxAmount = this.round2(subTotal * safeRate);
    const totalAmount = this.round2(subTotal + taxAmount);
    return { subTotal, taxAmount, totalAmount, taxRate: safeRate };
  }

  private async recalcOrderTotals(orderId: string) {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: { orderId },
    });
    const subTotal = this.round2(lines.reduce((s, l) => s + l.subTotal, 0));
    const taxTotal = this.round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = this.round2(
      lines.reduce((s, l) => s + l.totalAmount, 0),
    );
    return this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { subTotal, taxTotal, totalAmount },
    });
  }

  private async nextLineNo(orderId: string): Promise<number> {
    const last = await this.prisma.purchaseOrderLine.findFirst({
      where: { orderId },
      orderBy: { lineNo: 'desc' },
      select: { lineNo: true },
    });
    return (last?.lineNo ?? 0) + 1;
  }

  private generateOrderNo(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const seq = Math.floor(1000 + Math.random() * 9000);
    return `PO-${year}${month}-${seq}`;
  }

  private auditLog(
    userId: string,
    action: string,
    entityId: string,
    details: Prisma.InputJsonValue,
    companyId: string,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'purchase_order',
        entityId,
        details,
        companyId,
      },
    });
  }

  // =======================================
  // 创建采购单
  // =======================================
  async createPurchaseOrder(
    companyId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    const { partnerId, lines, expectedDate, notes } = dto;

    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, companyId, type: { in: ['SUPPLIER', 'BOTH'] } },
    });
    if (!partner) {
      throw new BadRequestException('供应商不存在或不是供应商类型');
    }

    const orderNo = this.generateOrderNo();
    let subTotal = 0;
    let taxTotal = 0;
    let totalAmount = 0;

    const lineCreates = (lines ?? []).map((line, index) => {
      const taxRate = line.taxRate ?? 0.13;
      const amounts = this.calcLineAmounts(
        line.quantity,
        line.unitPrice,
        taxRate,
      );
      subTotal += amounts.subTotal;
      taxTotal += amounts.taxAmount;
      totalAmount += amounts.totalAmount;
      return {
        lineNo: index + 1,
        materialId: line.materialId ?? null,
        productId: line.productId ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: amounts.taxRate,
        taxAmount: amounts.taxAmount,
        subTotal: amounts.subTotal,
        totalAmount: amounts.totalAmount,
        companyId,
      };
    });

    const created = await this.prisma.purchaseOrder.create({
      data: {
        orderNo,
        partnerId,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        status: 'DRAFT',
        subTotal: this.round2(subTotal),
        taxTotal: this.round2(taxTotal),
        totalAmount: this.round2(totalAmount),
        notes,
        companyId,
        lines: { create: lineCreates },
      },
      include: { lines: true, partner: true },
    });

    await this.auditLog(
      userId,
      'CREATE_PURCHASE_ORDER',
      created.id,
      { orderNo: created.orderNo, partnerId, lineCount: lineCreates.length },
      companyId,
    );

    return created;
  }

  // =======================================
  // 查询采购单列表
  // =======================================
  async getPurchaseOrders(
    companyId: string,
    pagination: PaginationDto,
    search?: string,
    status?: string,
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
        include: {
          partner: { select: { id: true, name: true, code: true } },
          lines: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // =======================================
  // 查询采购单详情
  // =======================================
  async getPurchaseOrderById(orderId: string, companyId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
      include: {
        partner: true,
        lines: {
          include: {
            material: { select: { id: true, sku: true, name: true } },
            product: { select: { id: true, sku: true, name: true } },
          },
          orderBy: { lineNo: 'asc' },
        },
        receipts: true,
      },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权查看');
    return po;
  }

  // =======================================
  // 添加行项 (仅 DRAFT 状态)
  // =======================================
  async addLine(
    orderId: string,
    companyId: string,
    userId: string,
    dto: AddPurchaseOrderLineDto,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权操作');
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('只能向草稿状态的采购单添加行项');
    }
    if (!dto.materialId && !dto.productId) {
      throw new BadRequestException('materialId 或 productId 至少填写一个');
    }

    const taxRate = dto.taxRate ?? 0.13;
    const amounts = this.calcLineAmounts(dto.quantity, dto.unitPrice, taxRate);
    const lineNo = await this.nextLineNo(orderId);

    const line = await this.prisma.purchaseOrderLine.create({
      data: {
        orderId,
        lineNo,
        materialId: dto.materialId ?? null,
        productId: dto.productId ?? null,
        description: dto.description ?? null,
        quantity: dto.quantity,
        unitPrice: dto.unitPrice,
        taxRate: amounts.taxRate,
        taxAmount: amounts.taxAmount,
        subTotal: amounts.subTotal,
        totalAmount: amounts.totalAmount,
        companyId,
      },
    });

    await this.recalcOrderTotals(orderId);
    await this.auditLog(
      userId,
      'ADD_PO_LINE',
      orderId,
      {
        lineNo,
        materialId: dto.materialId,
        productId: dto.productId,
      },
      companyId,
    );

    return line;
  }

  // =======================================
  // 提交审核 (DRAFT → SUBMITTED)
  // =======================================
  async submit(orderId: string, companyId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权操作');
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('只有草稿状态的采购单才能提交审核');
    }
    if (po.lines.length === 0) {
      throw new BadRequestException('采购单至少需要一行行项才能提交');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'SUBMITTED' },
      include: { lines: true, partner: true },
    });

    await this.auditLog(
      userId,
      'SUBMIT_PURCHASE_ORDER',
      orderId,
      {
        orderNo: po.orderNo,
        lineCount: po.lines.length,
        totalAmount: po.totalAmount,
      },
      companyId,
    );

    return updated;
  }

  // =======================================
  // 确认采购单 (SUBMITTED → APPROVED)
  // 确认后可生成收货单
  // =======================================
  async confirm(orderId: string, companyId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权操作');
    if (po.status !== 'SUBMITTED') {
      throw new BadRequestException('只有已提交审核的采购单才能确认');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'APPROVED' },
      include: { lines: true, partner: true },
    });

    await this.auditLog(
      userId,
      'CONFIRM_PURCHASE_ORDER',
      orderId,
      {
        orderNo: po.orderNo,
        totalAmount: po.totalAmount,
        lineCount: po.lines.length,
      },
      companyId,
    );

    return updated;
  }

  // =======================================
  // 删除草稿采购单 (仅 DRAFT)
  // =======================================
  async delete(orderId: string, companyId: string, userId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, companyId },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权操作');
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('只能删除草稿状态的采购单');
    }

    await this.prisma.purchaseOrderLine.deleteMany({ where: { orderId } });
    await this.prisma.purchaseOrder.delete({ where: { id: orderId } });

    await this.auditLog(
      userId,
      'DELETE_PURCHASE_ORDER',
      orderId,
      {
        orderNo: po.orderNo,
      },
      companyId,
    );

    return { id: orderId, deleted: true };
  }
}
