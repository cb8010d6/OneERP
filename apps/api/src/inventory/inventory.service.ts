import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MoveStatus, PickingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KyselyService } from '../core/prisma/kysely.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  ConfirmPickingDto,
  CreatePickingDto,
  CreateStockMoveDto,
  PurchaseInboundPostingDto,
  ReversePurchaseInboundDto,
  ReverseSaleOrderShipmentDto,
  SaleOrderShipmentDto,
} from './dto/inventory.dto';

// ---- Realtime Ledger Types ----
export interface StockLedgerRow {
  locationId: string;
  locationName: string;
  warehouseId: string | null;
  warehouseName: string | null;
  materialId: string;
  materialSku: string;
  materialName: string;
  materialUnit: string;
  minStock: number;
  netQty: number;
  batchCount: number;
  isLow: boolean;
}

interface StockLedgerQueryRow {
  locationId: string;
  locationName: string;
  warehouseId: string | null;
  warehouseName: string | null;
  materialId: string;
  materialSku: string;
  materialName: string;
  materialUnit: string;
  minStock: number | string | null;
  netQty: number | string | null;
  batchCount: number | string | null;
}

export interface InventoryTransactionRecord {
  id: string;
  type: string;
  materialId: string;
  quantity: number;
  referenceNo?: string | null;
  batchNo?: string | null;
  sourceLocationId?: string | null;
  destLocationId?: string | null;
  companyId?: string;
  operatorId?: string;
  note?: string | null;
}

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private readonly kyselyService: KyselyService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getCompanyStocks(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { location: { companyId } };

    const [data, total] = await Promise.all([
      this.prisma.stockQuant.findMany({
        where,
        include: {
          material: true,
          location: { include: { warehouse: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.prisma.stockQuant.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getWarehouses(companyId: string) {
    return this.prisma.warehouse.findMany({ where: { companyId } });
  }

  async getLocations(companyId: string, warehouseId?: string) {
    return this.prisma.stockLocation.findMany({
      where: {
        companyId,
        ...(warehouseId ? { warehouseId } : {}),
      },
      orderBy: [{ usage: 'asc' }, { name: 'asc' }],
    });
  }

  async getMaterials(companyId: string) {
    return this.prisma.material.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
    });
  }

  async getTransactions(companyId: string) {
    return this.prisma.inventoryTransaction.findMany({
      where: { companyId },
      include: {
        material: true,
        sourceLocation: { include: { warehouse: true } },
        destLocation: { include: { warehouse: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * 实时库存台账 – 使用 Kysely 聚合查询，按 location + material 汇总净库存量。
   * 支持低库存预警标记。
   */
  async getRealtimeLedger(companyId: string): Promise<StockLedgerRow[]> {
    const rows = await this.kyselyService.withTenant<StockLedgerQueryRow[]>(
      async (trx) => {
        const queryRows = await trx
          .selectFrom('StockQuant as sq')
          .innerJoin('StockLocation as loc', 'loc.id', 'sq.locationId')
          .innerJoin('Material as mat', 'mat.id', 'sq.materialId')
          .leftJoin('Warehouse as wh', 'wh.id', 'loc.warehouseId')
          .select([
            'loc.id as locationId',
            'loc.name as locationName',
            'loc.warehouseId as warehouseId',
            'wh.name as warehouseName',
            'mat.id as materialId',
            'mat.sku as materialSku',
            'mat.name as materialName',
            'mat.unit as materialUnit',
            'mat.minStock as minStock',
          ])
          .select((eb) => [
            eb.fn.sum<number>('sq.quantity').as('netQty'),
            eb.fn.count<number>('sq.id').as('batchCount'),
          ])
          .where('loc.companyId', '=', companyId)
          .groupBy([
            'loc.id',
            'loc.name',
            'loc.warehouseId',
            'wh.name',
            'mat.id',
            'mat.sku',
            'mat.name',
            'mat.unit',
            'mat.minStock',
          ])
          .orderBy('wh.name', 'asc')
          .orderBy('loc.name', 'asc')
          .orderBy('mat.name', 'asc')
          .execute();
        return queryRows as unknown as StockLedgerQueryRow[];
      },
    );

    return rows.map((row): StockLedgerRow => {
      const netQty = Number(row.netQty ?? 0);
      const minStock = Number(row.minStock ?? 0);
      return {
        locationId: String(row.locationId),
        locationName: String(row.locationName),
        warehouseId: row.warehouseId ? String(row.warehouseId) : null,
        warehouseName: row.warehouseName ? String(row.warehouseName) : null,
        materialId: String(row.materialId),
        materialSku: String(row.materialSku),
        materialName: String(row.materialName),
        materialUnit: String(row.materialUnit),
        minStock,
        netQty,
        batchCount: Number(row.batchCount ?? 0),
        isLow: minStock > 0 && netQty <= minStock,
      };
    });
  }

  async createStockMove(
    companyId: string,
    data: CreateStockMoveDto,
    operatorId?: string,
  ): Promise<InventoryTransactionRecord> {
    const sourceLocation = await this.resolveLocationOwnership(
      companyId,
      data.sourceLocationId,
      '来源库位',
    );
    const destLocation = await this.resolveLocationOwnership(
      companyId,
      data.destLocationId,
      '目标库位',
    );

    if (!sourceLocation?.id && !destLocation?.id) {
      throw new BadRequestException('来源库位和目标库位不能同时为空');
    }

    if (
      sourceLocation?.id &&
      destLocation?.id &&
      sourceLocation.id === destLocation.id
    ) {
      throw new BadRequestException('来源库位和目标库位不能相同');
    }

    const referenceNo = this.buildReferenceNo(
      data.referenceNo,
      data.documentType,
      data.documentId,
    );
    const finalNote =
      data.note ?? this.buildMoveNote(data.documentType, data.documentId);

    const material = await this.prisma.material.findFirst({
      where: { id: data.materialId },
      select: { id: true, unitPrice: true },
    });

    const transaction = await this.prisma.$transaction((tx) =>
      this.executeStockMove(tx, {
        companyId,
        materialId: data.materialId,
        quantity: data.quantity,
        sourceLocationId: sourceLocation?.id,
        destLocationId: destLocation?.id,
        batchNo: data.batchNo,
        operatorId: operatorId || 'SYSTEM',
        referenceNo,
        note: finalNote,
      }),
    );

    if (transaction.type === 'OUTBOUND') {
      this.eventEmitter.emit('inventory.stock_depleted', {
        companyId,
        idempotencyKey: `stock_depleted:${transaction.id}`,
        transactionId: transaction.id,
        referenceNo: transaction.referenceNo,
        materialId: transaction.materialId,
        quantity: transaction.quantity,
        unitCost: Number(material?.unitPrice ?? 0),
        operatorId: operatorId || 'SYSTEM',
      });
    }

    return transaction;
  }

  async createInbound(
    companyId: string,
    data: {
      destLocationId: string;
      materialId: string;
      quantity: number;
      batchNo?: string;
    },
    operatorId?: string,
  ) {
    return this.createStockMove(
      companyId,
      {
        materialId: data.materialId,
        destLocationId: data.destLocationId,
        quantity: data.quantity,
        batchNo: data.batchNo,
      },
      operatorId,
    );
  }

  async scanAndCreateOutboundRequest(
    companyId: string,
    userId: string,
    data: { materialSku: string; quantity: number },
  ) {
    const material = await this.prisma.material.findUnique({
      where: { sku: data.materialSku },
    });
    if (!material) throw new NotFoundException('未找到对应条码的物料');

    const quant = await this.prisma.stockQuant.findFirst({
      where: {
        materialId: material.id,
        quantity: { gt: 0 },
        location: { companyId },
      },
      orderBy: [{ quantity: 'desc' }],
      include: { location: true },
    });
    if (!quant) throw new BadRequestException('该公司无此物料库存');
    if (quant.quantity < data.quantity) {
      throw new BadRequestException(`库存不足，当前余量：${quant.quantity}`);
    }

    const referenceNo = `SCAN-${Date.now()}`;
    const transaction = await this.createStockMove(
      companyId,
      {
        sourceLocationId: quant.locationId,
        materialId: material.id,
        quantity: data.quantity,
        referenceNo,
        documentType: 'SCAN_OUTBOUND',
        documentId: referenceNo,
        note: '扫码直接出库',
      },
      userId,
    );

    return {
      transactionId: transaction.id,
      status: 'DONE',
      materialName: material.name,
      requestQuantity: data.quantity,
      message: `出库已完成，流转单号：${referenceNo}`,
    };
  }

  async approveAndDeductStock(companyId: string, transactionId: string) {
    const transaction = await this.prisma.inventoryTransaction.findFirst({
      where: { id: transactionId, companyId, type: 'OUTBOUND' },
    });
    if (!transaction) throw new NotFoundException('出库流转单不存在');

    return {
      success: true,
      message: '当前版本已改为过账即生效，无需审批。',
    };
  }

  /**
   * 销售订单发货（便捷方法）：创建拣货单 + 确认，一步完成。
   * 内部委托给 createSaleOrderPicking + confirmStockPicking，保持幂等。
   */
  async postSaleOrderShipment(
    companyId: string,
    orderId: string,
    payload: SaleOrderShipmentDto,
    operatorId?: string,
  ) {
    const pickingResult = await this.createSaleOrderPicking(
      companyId,
      orderId,
      { sourceLocationId: payload.sourceLocationId },
      operatorId,
    );

    const confirmResult = await this.confirmStockPicking(
      companyId,
      pickingResult.pickingId,
      { note: payload.note ?? `销售订单自动出库：${orderId}` },
      operatorId,
    );

    return {
      orderId,
      pickingId: pickingResult.pickingId,
      pickingNo: pickingResult.pickingNo,
      status: confirmResult.status,
      confirmedLines: confirmResult.confirmedLines ?? [],
      message: confirmResult.message,
    };
  }

  async postPurchaseInbound(
    companyId: string,
    payload: PurchaseInboundPostingDto,
    operatorId?: string,
  ) {
    const referenceNo = `PURCHASE-IN-${payload.purchaseNo}`;
    const existedMove = await this.prisma.inventoryTransaction.findFirst({
      where: {
        companyId,
        referenceNo,
        materialId: payload.materialId,
        type: 'INBOUND',
      },
      select: { id: true },
    });

    if (existedMove) {
      return {
        referenceNo,
        transactionId: existedMove.id,
        message: '采购单入库已过账，跳过重复处理',
      };
    }

    const transaction = await this.createStockMove(
      companyId,
      {
        materialId: payload.materialId,
        destLocationId: payload.destLocationId,
        quantity: payload.quantity,
        batchNo: payload.batchNo,
        referenceNo,
        documentType: 'PURCHASE_ORDER',
        documentId: payload.purchaseNo,
        note: payload.note ?? `采购自动入库：${payload.purchaseNo}`,
      },
      operatorId,
    );

    return {
      referenceNo,
      transactionId: transaction.id,
      message: '采购单自动入库过账完成',
    };
  }

  // =============================================================
  // Stock Picking: 销售发货改造
  // =============================================================

  async createSaleOrderPicking(
    companyId: string,
    orderId: string,
    payload: CreatePickingDto,
    _operatorId?: string,
  ) {
    void _operatorId;
    const sourceLocation = await this.resolveLocationOwnership(
      companyId,
      payload.sourceLocationId,
      '来源库位',
    );
    const destLocation = await this.resolveLocationOwnership(
      companyId,
      payload.destLocationId,
      '目标库位',
    );

    if (!sourceLocation?.id) {
      throw new BadRequestException('销售出库拣货单必须指定来源库位');
    }

    if (destLocation?.id && sourceLocation.id === destLocation.id) {
      throw new BadRequestException('来源库位和目标库位不能相同');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('销售订单不存在或无权限访问');
    if (!order.items.length)
      throw new BadRequestException('销售订单无明细，无法创建拣货单');

    const existingPicking = await this.prisma.stockPicking.findFirst({
      where: {
        companyId,
        referenceType: 'SALE_ORDER',
        referenceId: orderId,
        status: { notIn: [PickingStatus.CANCELLED] },
      },
    });

    if (existingPicking) {
      return {
        pickingId: existingPicking.id,
        pickingNo: existingPicking.pickingNo,
        status: existingPicking.status,
        message: '该订单已存在拣货单，已返回',
      };
    }

    const materialQuantityMap = new Map<string, number>();
    for (const item of order.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, companyId },
        select: { id: true, materialId: true, name: true },
      });
      if (!product)
        throw new BadRequestException(`订单项产品不存在：${item.productId}`);
      if (!product.materialId)
        throw new BadRequestException(
          `产品 ${product.name} 未绑定主物料，无法创建拣货单`,
        );
      const current = materialQuantityMap.get(product.materialId) ?? 0;
      materialQuantityMap.set(product.materialId, current + item.quantity);
    }

    const now = new Date();
    const pickingNo = `PICK-${now.getFullYear()}${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const picking = await this.prisma.stockPicking.create({
      data: {
        pickingNo,
        type: 'OUTBOUND',
        referenceType: 'SALE_ORDER',
        referenceId: orderId,
        scheduledDate: payload.scheduledDate
          ? new Date(payload.scheduledDate)
          : null,
        sourceLocationId: sourceLocation.id,
        destLocationId: destLocation?.id ?? null,
        status: PickingStatus.DRAFT,
        companyId,
        moves: {
          create: Array.from(materialQuantityMap.entries()).map(
            ([materialId, quantity], index) => ({
              lineNo: index + 1,
              materialId,
              sourceLocationId: sourceLocation.id,
              destLocationId: destLocation?.id ?? null,
              quantity,
              status: MoveStatus.DRAFT,
              companyId,
            }),
          ),
        },
      },
      include: { moves: true },
    });

    return {
      pickingId: picking.id,
      pickingNo: picking.pickingNo,
      status: picking.status,
      moveCount: picking.moves.length,
      message: '拣货单已创建，状态为 DRAFT',
    };
  }
  async confirmStockPicking(
    companyId: string,
    pickingId: string,
    payload: ConfirmPickingDto,
    operatorId?: string,
  ) {
    const picking = await this.prisma.stockPicking.findFirst({
      where: { id: pickingId, companyId },
      include: { moves: { orderBy: { lineNo: 'asc' } } },
    });

    if (!picking) throw new NotFoundException('拣货单不存在或无权限访问');

    if (picking.status === PickingStatus.DONE) {
      return {
        pickingId: picking.id,
        pickingNo: picking.pickingNo,
        status: picking.status,
        message: '拣货单已确认完成，跳过重复处理',
      };
    }

    if (picking.status === PickingStatus.CANCELLED)
      throw new BadRequestException('拣货单已取消，无法确认');
    if (!picking.moves.length)
      throw new BadRequestException('拣货单无明细行，无法确认');

    for (const move of picking.moves) {
      if (
        move.status !== MoveStatus.CANCELLED &&
        move.status !== MoveStatus.DONE &&
        !move.sourceLocationId
      ) {
        throw new BadRequestException(
          `拣货单行 ${move.lineNo} 缺少来源库位，无法确认出库`,
        );
      }
      if (
        move.sourceLocationId &&
        move.destLocationId &&
        move.sourceLocationId === move.destLocationId
      ) {
        throw new BadRequestException(
          `拣货单行 ${move.lineNo} 来源库位和目标库位不能相同`,
        );
      }
    }

    const referenceNo = `PICKING-${picking.pickingNo}`;
    const note = payload.note ?? `拣货单确认出库：${picking.pickingNo}`;
    const confirmedLines: Array<{
      moveId: string;
      materialId: string;
      quantity: number;
      transactionId: string;
    }> = [];
    const skippedLines: Array<{
      moveId: string;
      materialId: string;
      message: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const move of picking.moves) {
        if (move.status === MoveStatus.DONE) {
          skippedLines.push({
            moveId: move.id,
            materialId: move.materialId,
            message: '该行已执行过，跳过',
          });
          continue;
        }
        if (move.status === MoveStatus.CANCELLED) {
          skippedLines.push({
            moveId: move.id,
            materialId: move.materialId,
            message: '该行已取消，跳过',
          });
          continue;
        }

        const claimed = await tx.stockMove.updateMany({
          where: {
            id: move.id,
            status: { in: [MoveStatus.DRAFT, MoveStatus.CONFIRMED] },
          },
          data: { status: MoveStatus.CONFIRMED },
        });

        if (claimed.count === 0) {
          skippedLines.push({
            moveId: move.id,
            materialId: move.materialId,
            message: '该行已被其他确认流程处理，跳过',
          });
          continue;
        }

        const lineNote = `${note} (行${move.lineNo})`;
        const transaction = await this.executeStockMove(tx, {
          companyId,
          materialId: move.materialId,
          quantity: move.quantity,
          sourceLocationId: move.sourceLocationId ?? undefined,
          destLocationId: move.destLocationId ?? undefined,
          batchNo: move.batchNo ?? undefined,
          referenceNo,
          note: lineNote,
          operatorId: operatorId || 'SYSTEM',
          stockMoveId: move.id,
        });

        await tx.stockMove.update({
          where: { id: move.id },
          data: { status: MoveStatus.DONE, quantityDone: move.quantity },
        });

        confirmedLines.push({
          moveId: move.id,
          materialId: move.materialId,
          quantity: move.quantity,
          transactionId: transaction.id,
        });
      }

      await tx.stockPicking.update({
        where: { id: picking.id },
        data: { status: PickingStatus.DONE, completedDate: new Date() },
      });

      if (picking.referenceType === 'SALE_ORDER' && picking.referenceId) {
        await tx.order.update({
          where: { id: picking.referenceId },
          data: { status: 'SHIPPED' },
        });
      }
    });

    for (const line of confirmedLines) {
      this.eventEmitter.emit('inventory.stock_depleted', {
        companyId,
        referenceNo,
        materialId: line.materialId,
        quantity: line.quantity,
        operatorId: operatorId || 'SYSTEM',
      });
    }

    return {
      pickingId: picking.id,
      pickingNo: picking.pickingNo,
      status: PickingStatus.DONE,
      confirmedLines,
      skippedLines,
      message: `拣货单已确认完成，${confirmedLines.length} 行已执行`,
    };
  }

  async getPickings(
    companyId: string,
    pagination: PaginationDto,
    status?: string,
  ) {
    const { page = 1, limit = 20 } = pagination;
    const where: Prisma.StockPickingWhereInput = { companyId };
    const pickingStatus = this.parsePickingStatus(status);
    if (pickingStatus) where.status = pickingStatus;

    const [data, total] = await Promise.all([
      this.prisma.stockPicking.findMany({
        where,
        include: { moves: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockPicking.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getPickingById(pickingId: string, companyId: string) {
    const picking = await this.prisma.stockPicking.findFirst({
      where: { id: pickingId, companyId },
      include: { moves: { include: { material: true } } },
    });

    if (!picking) throw new NotFoundException('拣货单不存在或无权限访问');
    return picking;
  }

  async reverseSaleOrderShipment(
    companyId: string,
    orderId: string,
    payload: ReverseSaleOrderShipmentDto,
    operatorId?: string,
    options?: { rollbackStatus?: boolean },
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, orderNo: true },
    });

    if (!order) {
      throw new NotFoundException('销售订单不存在或无权限访问');
    }

    const shipmentReferenceNo = `SALE-SHIP-${order.orderNo}`;
    const reverseReferenceNo = `SALE-SHIP-REV-${order.orderNo}`;

    const existedReverse = await this.prisma.inventoryTransaction.count({
      where: { companyId, referenceNo: reverseReferenceNo },
    });

    if (existedReverse > 0) {
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        reversedLines: [],
        message: '销售订单冲销已存在，已跳过重复处理',
      };
    }

    const shippedMoves = await this.prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        referenceNo: shipmentReferenceNo,
        type: 'OUTBOUND',
      },
      select: {
        materialId: true,
        quantity: true,
        sourceLocationId: true,
      },
    });

    if (!shippedMoves.length) {
      throw new BadRequestException('未找到可冲销的销售出库流水');
    }

    const reversedLines: Array<{
      materialId: string;
      quantity: number;
      transactionId: string;
    }> = [];

    for (const move of shippedMoves) {
      const transaction = await this.createStockMove(
        companyId,
        {
          materialId: move.materialId,
          quantity: move.quantity,
          destLocationId:
            payload.destLocationId ?? move.sourceLocationId ?? undefined,
          batchNo: payload.batchNo,
          referenceNo: reverseReferenceNo,
          documentType: 'SALE_ORDER_REVERSE',
          documentId: order.id,
          note: payload.note ?? `销售订单冲销回库：${order.orderNo}`,
        },
        operatorId,
      );

      reversedLines.push({
        materialId: move.materialId,
        quantity: move.quantity,
        transactionId: transaction.id,
      });
    }

    if (options?.rollbackStatus !== false) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'IN_PRODUCTION' },
      });
    }

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      reversedLines,
      message:
        options?.rollbackStatus === false
          ? '销售订单冲销完成'
          : '销售订单冲销完成，订单状态已回退为 IN_PRODUCTION',
    };
  }

  async reversePurchaseInbound(
    companyId: string,
    purchaseNo: string,
    payload: ReversePurchaseInboundDto,
    operatorId?: string,
  ) {
    const purchaseReferenceNo = `PURCHASE-IN-${purchaseNo}`;
    const reverseReferenceNo = `PURCHASE-IN-REV-${purchaseNo}`;

    const existedReverse = await this.prisma.inventoryTransaction.count({
      where: { companyId, referenceNo: reverseReferenceNo },
    });

    if (existedReverse > 0) {
      return {
        purchaseNo,
        reversedLines: [],
        message: '采购入库冲销已存在，已跳过重复处理',
      };
    }

    const inboundMoves = await this.prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        referenceNo: purchaseReferenceNo,
        type: 'INBOUND',
      },
      select: {
        materialId: true,
        quantity: true,
        destLocationId: true,
      },
    });

    if (!inboundMoves.length) {
      throw new BadRequestException('未找到可冲销的采购入库流水');
    }

    const reversedLines: Array<{
      materialId: string;
      quantity: number;
      transactionId: string;
    }> = [];

    for (const move of inboundMoves) {
      const transaction = await this.createStockMove(
        companyId,
        {
          materialId: move.materialId,
          quantity: move.quantity,
          sourceLocationId:
            payload.sourceLocationId ?? move.destLocationId ?? undefined,
          batchNo: payload.batchNo,
          referenceNo: reverseReferenceNo,
          documentType: 'PURCHASE_ORDER_REVERSE',
          documentId: purchaseNo,
          note: payload.note ?? `采购入库冲销：${purchaseNo}`,
        },
        operatorId,
      );

      reversedLines.push({
        materialId: move.materialId,
        quantity: move.quantity,
        transactionId: transaction.id,
      });
    }

    return {
      purchaseNo,
      reversedLines,
      message: '采购入库冲销完成',
    };
  }

  private async resolveLocationOwnership(
    companyId: string,
    locationId: string | undefined,
    label: string,
  ) {
    if (!locationId) return undefined;

    const location = await this.prisma.stockLocation.findFirst({
      where: { id: locationId, companyId },
      select: { id: true, name: true, warehouseId: true },
    });

    if (!location) {
      throw new BadRequestException(`${label}不存在或无权限访问`);
    }

    return location;
  }

  private buildReferenceNo(
    referenceNo?: string,
    documentType?: string,
    documentId?: string,
  ) {
    if (referenceNo) return referenceNo;
    if (documentType && documentId) {
      return `${documentType}-${documentId}-${Date.now()}`;
    }
    return undefined;
  }

  private buildMoveNote(documentType?: string, documentId?: string) {
    if (!documentType || !documentId) return undefined;
    return `自动过账：${documentType}#${documentId}`;
  }

  private generateBatchNo() {
    return `BATCH${Date.now()}`;
  }

  private parsePickingStatus(status?: string): PickingStatus | undefined {
    if (!status) return undefined;

    const normalized = status.trim().toUpperCase();
    const validStatus = Object.values(PickingStatus).find(
      (value) => value === normalized,
    );

    if (!validStatus) {
      throw new BadRequestException(`不支持的拣货单状态：${status}`);
    }

    return validStatus;
  }

  private async executeStockMove(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      materialId: string;
      quantity: number;
      sourceLocationId?: string;
      destLocationId?: string;
      batchNo?: string;
      operatorId: string;
      referenceNo?: string;
      note?: string;
      stockMoveId?: string;
    },
  ): Promise<InventoryTransactionRecord> {
    let finalBatchNo = input.batchNo;

    if (input.sourceLocationId) {
      const reserved = await this.reserveSourceStock(tx, {
        sourceLocationId: input.sourceLocationId,
        materialId: input.materialId,
        quantity: input.quantity,
        batchNo: finalBatchNo,
      });

      finalBatchNo = finalBatchNo ?? reserved.batchNo;
    }

    if (input.destLocationId) {
      const destinationBatch =
        finalBatchNo ?? input.batchNo ?? this.generateBatchNo();
      await tx.stockQuant.upsert({
        where: {
          locationId_materialId_batchNo: {
            locationId: input.destLocationId,
            materialId: input.materialId,
            batchNo: destinationBatch,
          },
        },
        create: {
          locationId: input.destLocationId,
          materialId: input.materialId,
          batchNo: destinationBatch,
          quantity: input.quantity,
        },
        update: {
          quantity: { increment: input.quantity },
        },
      });
      finalBatchNo = destinationBatch;
    }

    const moveType =
      input.sourceLocationId && input.destLocationId
        ? 'TRANSFER'
        : input.sourceLocationId
          ? 'OUTBOUND'
          : 'INBOUND';

    return tx.inventoryTransaction.create({
      data: {
        type: moveType,
        materialId: input.materialId,
        sourceLocationId: input.sourceLocationId,
        destLocationId: input.destLocationId,
        quantity: input.quantity,
        batchNo: finalBatchNo ?? this.generateBatchNo(),
        operatorId: input.operatorId,
        companyId: input.companyId,
        referenceNo: input.referenceNo,
        note: input.note,
        stockMoveId: input.stockMoveId,
      },
    });
  }

  private async reserveSourceStock(
    tx: Prisma.TransactionClient,
    input: {
      sourceLocationId: string;
      materialId: string;
      quantity: number;
      batchNo?: string;
    },
  ): Promise<{ batchNo: string }> {
    if (input.batchNo) {
      const updated = await tx.stockQuant.updateMany({
        where: {
          locationId: input.sourceLocationId,
          materialId: input.materialId,
          batchNo: input.batchNo,
          quantity: { gte: input.quantity },
        },
        data: { quantity: { decrement: input.quantity } },
      });

      if (updated.count === 0) {
        throw new ConflictException('可用库存不足或被并发占用，请刷新后重试');
      }

      return { batchNo: input.batchNo };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await tx.stockQuant.findFirst({
        where: {
          locationId: input.sourceLocationId,
          materialId: input.materialId,
          quantity: { gte: input.quantity },
        },
        orderBy: [{ createdAt: 'asc' }],
        select: { id: true, batchNo: true },
      });

      if (!candidate) {
        break;
      }

      const updated = await tx.stockQuant.updateMany({
        where: {
          id: candidate.id,
          quantity: { gte: input.quantity },
        },
        data: { quantity: { decrement: input.quantity } },
      });

      if (updated.count > 0) {
        return { batchNo: candidate.batchNo };
      }
    }

    throw new ConflictException('可用库存不足或被并发占用，请刷新后重试');
  }
}
