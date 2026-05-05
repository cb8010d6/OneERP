import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  CreateGoodsReceiptDto,
  ConfirmGoodsReceiptDto,
  ReverseGoodsReceiptDto,
} from './dto/create-goods-receipt.dto';

@Injectable()
export class GoodsReceiptsService {
  private readonly logger = new Logger(GoodsReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  private generateReceiptNo(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const seq = Math.floor(1000 + Math.random() * 9000);
    return `GR-${year}${month}-${seq}`;
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
        entity: 'goods_receipt',
        entityId,
        details,
        companyId,
      },
    });
  }

  // =======================================
  // 创建收货单
  // =======================================
  async create(companyId: string, userId: string, dto: CreateGoodsReceiptDto) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, companyId },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('采购单不存在或无权操作');
    if (po.status === 'CANCELLED')
      throw new BadRequestException('已取消的采购单不能创建收货单');
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new BadRequestException(
        '只有已审批或部分收货的采购单才能创建收货单',
      );
    }
    if (po.partnerId !== dto.partnerId) {
      throw new BadRequestException('供应商与采购单不匹配');
    }

    const poLineMap = new Map(po.lines.map((l) => [l.id, l]));
    for (const line of dto.lines) {
      const poLine = poLineMap.get(line.orderLineId);
      if (!poLine)
        throw new BadRequestException(`采购单行 ${line.orderLineId} 不存在`);
      const remaining = poLine.quantity - poLine.receivedQuantity;
      if (line.quantity > remaining) {
        throw new BadRequestException(
          `物料 ${line.materialId} 收货数量(${line.quantity})超过可收货数量(${remaining})`,
        );
      }
    }

    const receiptNo = this.generateReceiptNo();
    const receipt = await this.prisma.goodsReceipt.create({
      data: {
        receiptNo,
        orderId: dto.purchaseOrderId,
        partnerId: dto.partnerId,
        status: 'DRAFT',
        notes: dto.notes,
        companyId,
        lines: {
          create: dto.lines.map((line) => ({
            productId: line.productId,
            materialId: line.materialId,
            locationId: line.locationId,
            quantity: line.quantity,
            batchNo: line.batchNo ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    await this.auditLog(
      userId,
      'CREATE_GOODS_RECEIPT',
      receipt.id,
      {
        receiptNo,
        purchaseOrderId: dto.purchaseOrderId,
        lineCount: dto.lines.length,
      },
      companyId,
    );

    this.logger.log(`收货单 ${receiptNo} 创建成功`);
    return receipt;
  }

  // =======================================
  // 确认收货 → 触发库存入库
  // =======================================
  async confirm(
    companyId: string,
    receiptId: string,
    dto: ConfirmGoodsReceiptDto,
    operatorId: string,
  ) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id: receiptId, companyId },
      include: {
        lines: true,
        order: { include: { lines: true } },
      },
    });

    if (!receipt) throw new NotFoundException('收货单不存在或无权操作');
    if (receipt.status === 'CONFIRMED') {
      return {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        status: receipt.status,
        message: '收货单已确认，跳过重复处理',
      };
    }
    if (receipt.status === 'CANCELLED')
      throw new BadRequestException('已取消的收货单不能确认');
    if (!receipt.lines.length)
      throw new BadRequestException('收货单无明细行，无法确认');

    const referenceNo = `GR-${receipt.receiptNo}`;
    const confirmedLines: Array<{
      lineId: string;
      materialId: string;
      quantity: number;
      transactionId: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const line of receipt.lines) {
        const transaction = await this.inventoryService.createStockMove(
          companyId,
          {
            materialId: line.materialId,
            destLocationId: line.locationId,
            quantity: line.quantity,
            batchNo: line.batchNo ?? undefined,
            referenceNo,
            documentType: 'GOODS_RECEIPT',
            documentId: receipt.id,
            note: dto.note ?? `收货单确认入库：${receipt.receiptNo}`,
          },
          operatorId,
        );
        confirmedLines.push({
          lineId: line.id,
          materialId: line.materialId,
          quantity: line.quantity,
          transactionId: transaction.id,
        });
      }

      // 更新采购单行已收货数量
      if (receipt.order) {
        for (const line of receipt.lines) {
          const matchedPoLine = receipt.order.lines.find(
            (l) => l.materialId === line.materialId,
          );
          if (matchedPoLine) {
            await tx.purchaseOrderLine.update({
              where: { id: matchedPoLine.id },
              data: { receivedQuantity: { increment: line.quantity } },
            });
          }
        }

        const updatedPoLines = await tx.purchaseOrderLine.findMany({
          where: { orderId: receipt.order.id },
        });
        const allReceived = updatedPoLines.every(
          (l) => l.receivedQuantity >= l.quantity,
        );
        const anyReceived = updatedPoLines.some((l) => l.receivedQuantity > 0);
        let newStatus = receipt.order.status;
        if (allReceived) newStatus = PurchaseOrderStatus.RECEIVED;
        else if (anyReceived)
          newStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;
        if (newStatus !== receipt.order.status) {
          await tx.purchaseOrder.update({
            where: { id: receipt.order.id },
            data: { status: newStatus },
          });
        }
      }

      await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: 'CONFIRMED' },
      });
    });

    await this.auditLog(
      operatorId,
      'CONFIRM_GOODS_RECEIPT',
      receipt.id,
      {
        receiptNo: receipt.receiptNo,
        confirmedLineCount: confirmedLines.length,
      },
      companyId,
    );

    this.logger.log(
      `收货单 ${receipt.receiptNo} 已确认，${confirmedLines.length} 行已入库`,
    );
    return {
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      status: 'CONFIRMED',
      confirmedLines,
      message: `收货单已确认完成，${confirmedLines.length} 行已入库`,
    };
  }

  // =======================================
  // 冲销收货单 → 生成反向库存流水
  // =======================================
  async reverse(
    companyId: string,
    receiptId: string,
    dto: ReverseGoodsReceiptDto,
    operatorId: string,
  ) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id: receiptId, companyId },
      include: { lines: true },
    });

    if (!receipt) throw new NotFoundException('收货单不存在或无权操作');
    if (receipt.status !== 'CONFIRMED')
      throw new BadRequestException('只有已确认的收货单才能冲销');

    const referenceNo = `GR-REV-${receipt.receiptNo}`;
    const reverseNote = dto.note ?? `收货单冲销：${receipt.receiptNo}`;

    const existedReverse = await this.prisma.inventoryTransaction.count({
      where: { companyId, referenceNo },
    });
    if (existedReverse > 0) {
      return {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        reversedLines: [],
        message: '收货单已冲销，跳过重复处理',
      };
    }

    const reversedLines: Array<{
      lineId: string;
      materialId: string;
      quantity: number;
      transactionId: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const line of receipt.lines) {
        const transaction = await this.inventoryService.createStockMove(
          companyId,
          {
            materialId: line.materialId,
            sourceLocationId:
              dto.sourceLocationId ?? line.locationId ?? undefined,
            quantity: line.quantity,
            batchNo: line.batchNo ?? undefined,
            referenceNo,
            documentType: 'GOODS_RECEIPT_REVERSE',
            documentId: receipt.id,
            note: `${reverseNote} (行${line.id})`,
          },
          operatorId,
        );
        reversedLines.push({
          lineId: line.id,
          materialId: line.materialId,
          quantity: line.quantity,
          transactionId: transaction.id,
        });
      }

      // 回退采购单行已收货数量
      if (receipt.orderId) {
        const poLines = await tx.purchaseOrderLine.findMany({
          where: { orderId: receipt.orderId },
        });
        for (const line of receipt.lines) {
          const matchedPoLine = poLines.find(
            (l) => l.materialId === line.materialId,
          );
          if (matchedPoLine) {
            await tx.purchaseOrderLine.update({
              where: { id: matchedPoLine.id },
              data: {
                receivedQuantity: {
                  decrement: Math.min(
                    line.quantity,
                    matchedPoLine.receivedQuantity,
                  ),
                },
              },
            });
          }
        }
        const updatedPoLines = await tx.purchaseOrderLine.findMany({
          where: { orderId: receipt.orderId },
        });
        const allReceived = updatedPoLines.every(
          (l) => l.receivedQuantity >= l.quantity,
        );
        const anyReceived = updatedPoLines.some((l) => l.receivedQuantity > 0);
        let newStatus: PurchaseOrderStatus = PurchaseOrderStatus.APPROVED;
        if (allReceived) newStatus = PurchaseOrderStatus.RECEIVED;
        else if (anyReceived)
          newStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;
        await tx.purchaseOrder.update({
          where: { id: receipt.orderId },
          data: { status: newStatus },
        });
      }

      await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: 'CANCELLED' },
      });
    });

    await this.auditLog(
      operatorId,
      'REVERSE_GOODS_RECEIPT',
      receipt.id,
      {
        receiptNo: receipt.receiptNo,
        reversedLineCount: reversedLines.length,
      },
      companyId,
    );

    this.logger.log(
      `收货单 ${receipt.receiptNo} 已冲销，${reversedLines.length} 行已执行反向出库`,
    );
    return {
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      status: 'CANCELLED',
      reversedLines,
      message: `收货单已冲销完成，${reversedLines.length} 行已执行反向出库`,
    };
  }

  // =======================================
  // 查询收货单列表
  // =======================================
  async findAll(companyId: string, pagination: PaginationDto, status?: string) {
    const { page = 1, limit = 20 } = pagination;
    const where: Prisma.GoodsReceiptWhereInput = { companyId };
    if (status && status in GoodsReceiptStatus) {
      where.status = status as GoodsReceiptStatus;
    }

    const [data, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true, code: true } },
          order: { select: { id: true, orderNo: true } },
          lines: {
            include: {
              material: { select: { id: true, sku: true, name: true } },
              location: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // =======================================
  // 查询收货单详情
  // =======================================
  async findOne(receiptId: string, companyId: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id: receiptId, companyId },
      include: {
        partner: true,
        order: {
          include: {
            lines: {
              include: {
                material: { select: { id: true, sku: true, name: true } },
              },
            },
          },
        },
        lines: {
          include: {
            material: true,
            product: true,
            location: { include: { warehouse: true } },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('收货单不存在或无权操作');
    return receipt;
  }
}
