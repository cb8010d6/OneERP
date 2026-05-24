import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { roundDecimal } from '../core/utils/decimal';
import {
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase.dto';

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async createPurchaseOrder(
    companyId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    const supplier = await this.prisma.partner.findFirst({
      where: {
        id: dto.supplierId,
        companyId,
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
      },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('供应商不存在或未启用');
    }

    const materialIds = dto.items.map((item) => item.materialId);
    const materialCount = await this.prisma.material.count({
      where: {
        id: { in: materialIds },
        OR: [{ companyId }, { companyId: null }],
      },
    });
    if (materialCount !== new Set(materialIds).size) {
      throw new BadRequestException('采购明细包含不存在的物料');
    }

    const lines = dto.items.map((item) => {
      const quantity = new Decimal(item.quantity);
      const unitPrice = new Decimal(item.unitPrice);
      const subTotal = this.money(quantity.times(unitPrice));
      return {
        materialId: item.materialId,
        quantity,
        unitPrice,
        subTotal,
        totalPrice: subTotal,
        taxAmount: new Decimal(0),
        note: item.note,
      };
    });

    const subTotal = this.money(
      lines.reduce((sum, line) => sum.plus(line.subTotal), new Decimal(0)),
    );

    return this.prisma.purchaseOrder.create({
      data: {
        purchaseNo: this.generateDocumentNo('PO'),
        supplierId: dto.supplierId,
        buyerId: userId,
        companyId,
        status: 'ORDERED',
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        notes: dto.notes,
        subTotal,
        taxTotal: 0,
        totalAmount: subTotal,
        items: {
          create: lines.map((line) => ({
            materialId: line.materialId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            subTotal: line.subTotal,
            taxAmount: line.taxAmount,
            totalPrice: line.totalPrice,
            note: line.note,
          })),
        },
      },
      include: this.purchaseOrderInclude(),
    });
  }

  async listPurchaseOrders(companyId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: this.purchaseOrderInclude(),
      take: 100,
    });
  }

  async getPurchaseOrder(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: this.purchaseOrderInclude(),
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    return order;
  }

  async receivePurchaseOrder(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseOrderDto,
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    if (['CANCELLED', 'RECEIVED'].includes(order.status)) {
      throw new BadRequestException('当前采购单状态不允许收货');
    }

    const lineMap = new Map(order.items.map((line) => [line.id, line]));
    for (const line of dto.lines) {
      const orderLine = lineMap.get(line.purchaseOrderLineId);
      if (!orderLine) {
        throw new BadRequestException('收货明细不属于当前采购单');
      }
      const nextReceived = new Decimal(orderLine.receivedQty).plus(
        line.quantity,
      );
      if (nextReceived.gt(orderLine.quantity)) {
        throw new BadRequestException('收货数量不能超过采购数量');
      }
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseReceipt.create({
        data: {
          receiptNo: this.generateDocumentNo('GR'),
          purchaseOrderId: order.id,
          companyId,
          operatorId: userId,
          note: dto.note,
          lines: {
            create: dto.lines.map((line) => {
              const orderLine = lineMap.get(line.purchaseOrderLineId);
              if (!orderLine) {
                throw new BadRequestException('收货明细不属于当前采购单');
              }
              return {
                purchaseOrderLineId: orderLine.id,
                materialId: orderLine.materialId,
                quantity: line.quantity,
                destLocationId: line.destLocationId,
                batchNo: line.batchNo,
              };
            }),
          },
        },
        include: { lines: true },
      });

      for (const line of dto.lines) {
        const orderLine = lineMap.get(line.purchaseOrderLineId);
        if (!orderLine) continue;
        await tx.purchaseOrderLine.update({
          where: { id: orderLine.id },
          data: {
            receivedQty: new Decimal(orderLine.receivedQty).plus(line.quantity),
          },
        });
      }

      const updatedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: order.id },
      });
      const fullyReceived = updatedLines.every((line) =>
        new Decimal(line.receivedQty).gte(line.quantity),
      );
      const partiallyReceived = updatedLines.some((line) =>
        new Decimal(line.receivedQty).gt(0),
      );
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: fullyReceived
            ? 'RECEIVED'
            : partiallyReceived
              ? 'PARTIAL_RECEIVED'
              : 'ORDERED',
        },
      });

      return created;
    });

    for (const line of receipt.lines) {
      await this.inventoryService.createStockMove(
        companyId,
        {
          materialId: line.materialId,
          destLocationId: line.destLocationId ?? undefined,
          quantity: Number(line.quantity),
          batchNo: line.batchNo ?? undefined,
          referenceNo: `PURCHASE-IN-${order.purchaseNo}-${receipt.receiptNo}`,
          documentType: 'PURCHASE_RECEIPT',
          documentId: receipt.receiptNo,
          note: dto.note ?? `采购收货：${order.purchaseNo}`,
        },
        userId,
      );
    }

    return this.getPurchaseOrder(companyId, id);
  }

  async createPurchaseInvoice(
    companyId: string,
    id: string,
    dto: CreatePurchaseInvoiceDto,
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { invoices: true },
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    if (!['PARTIAL_RECEIVED', 'RECEIVED'].includes(order.status)) {
      throw new BadRequestException('采购单未收货，不能生成应付发票');
    }
    if (order.invoices.length > 0) {
      throw new BadRequestException('该采购单已生成应付发票');
    }

    return this.prisma.purchaseInvoice.create({
      data: {
        invoiceNo: dto.invoiceNo?.trim() || this.generateDocumentNo('PI'),
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        companyId,
        amount: order.totalAmount,
        subTotal: order.subTotal,
        taxAmount: order.taxTotal,
        status: 'UNPAID',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        purchaseOrder: true,
        supplier: true,
      },
    });
  }

  private purchaseOrderInclude() {
    return {
      supplier: true,
      items: { include: { material: true } },
      receipts: {
        include: { lines: true },
        orderBy: { createdAt: 'desc' as const },
      },
      invoices: true,
    };
  }

  private money(value: Decimal.Value) {
    return new Decimal(roundDecimal(value));
  }

  private generateDocumentNo(prefix: string) {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    return `${prefix}-${date}-${String(now.getTime()).slice(-6)}`;
  }
}
