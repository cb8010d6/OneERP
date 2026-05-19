import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { sql } from 'kysely';
import { PrismaService } from '../prisma/prisma.service';
import { KyselyService } from '../core/prisma/kysely.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { roundDecimal } from '../core/utils/decimal';
import {
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

  async postSaleOrderShipment(
    companyId: string,
    orderId: string,
    payload: SaleOrderShipmentDto,
    operatorId?: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: {
        items: {
          select: { productId: true, quantity: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('销售订单不存在或无权限访问');
    }

    if (!order.items.length) {
      throw new BadRequestException('销售订单无明细，无法自动过账');
    }

    if (!payload.items?.length) {
      throw new BadRequestException('销售订单发货明细不能为空');
    }

    const orderProductIds = [
      ...new Set(order.items.map((item) => item.productId)),
    ];
    const products = await this.prisma.product.findMany({
      where: { companyId, id: { in: orderProductIds } },
      select: { id: true, materialId: true, name: true, sku: true },
    });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    const productByMaterialId = new Map(
      products
        .filter((product) => product.materialId)
        .map((product) => [product.materialId as string, product.id]),
    );

    const orderedQuantityByProductId = new Map<string, number>();
    for (const item of order.items) {
      const current = orderedQuantityByProductId.get(item.productId) ?? 0;
      orderedQuantityByProductId.set(
        item.productId,
        current + Number(item.quantity ?? 0),
      );
    }

    const referenceNo = `SALE-SHIP-${order.orderNo}`;
    const shippedMoves = await this.prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        referenceNo,
        type: 'OUTBOUND',
      },
      select: {
        materialId: true,
        quantity: true,
      },
    });

    const shippedQuantityByProductId = new Map<string, number>();
    for (const move of shippedMoves) {
      const productId = productByMaterialId.get(move.materialId);
      if (!productId) continue;

      const current = shippedQuantityByProductId.get(productId) ?? 0;
      shippedQuantityByProductId.set(
        productId,
        current + Number(move.quantity ?? 0),
      );
    }

    const totalOrdered = this.round2(
      order.items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    );

    const postedLines: Array<{
      productId: string;
      materialId: string;
      requestedQuantity: number;
      quantity: number;
      remainingQuantity: number;
      sourceLocationId: string;
      batchNo: string;
      transactionId: string;
      allocations: Array<{
        sourceLocationId: string;
        batchNo: string;
        quantity: number;
        transactionId: string;
      }>;
    }> = [];
    const skippedLines: Array<{
      productId: string;
      requestedQuantity: number;
      reason: string;
    }> = [];

    for (const requestItem of payload.items) {
      const requestedQuantity = Number(requestItem.shipQuantity ?? 0);
      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
        skippedLines.push({
          productId: requestItem.productId,
          requestedQuantity: 0,
          reason: '发货数量必须大于0',
        });
        continue;
      }

      const product = productById.get(requestItem.productId);
      if (!product) {
        skippedLines.push({
          productId: requestItem.productId,
          requestedQuantity,
          reason: '销售订单中不存在该产品',
        });
        continue;
      }

      if (!product.materialId) {
        skippedLines.push({
          productId: requestItem.productId,
          requestedQuantity,
          reason: `产品 ${product.name} 未绑定主物料，无法发货`,
        });
        continue;
      }

      const orderedQuantity = orderedQuantityByProductId.get(product.id) ?? 0;
      const alreadyShippedQuantity =
        shippedQuantityByProductId.get(product.id) ?? 0;
      const remainingQuantity = Math.max(
        0,
        this.round2(orderedQuantity - alreadyShippedQuantity),
      );

      if (remainingQuantity <= 0) {
        skippedLines.push({
          productId: product.id,
          requestedQuantity,
          reason: '该订单项已全部发货',
        });
        continue;
      }

      const quantityRequestedThisRound = this.round2(
        Math.min(requestedQuantity, remainingQuantity),
      );

      const stockPlan = await this.resolveShipmentAllocations(
        companyId,
        product.materialId,
        quantityRequestedThisRound,
        payload.sourceLocationId,
        payload.batchNo,
      );

      if (!stockPlan.allocations.length || stockPlan.allocatedQuantity <= 0) {
        skippedLines.push({
          productId: product.id,
          requestedQuantity,
          reason: '当前库存不足，最大可发货量为 0',
        });
        continue;
      }

      try {
        const lineTransactions = await this.prisma.$transaction(async (tx) => {
          const nextTransactions: Array<{
            sourceLocationId: string;
            batchNo: string;
            quantity: number;
            transactionId: string;
            referenceNo: string;
          }> = [];

          for (const allocation of stockPlan.allocations) {
            const transaction = await this.executeStockMove(tx, {
              companyId,
              sourceLocationId: allocation.sourceLocationId,
              materialId: product.materialId as string,
              quantity: allocation.quantity,
              batchNo: allocation.batchNo,
              referenceNo,
              note: payload.note ?? `销售订单自动出库：${order.orderNo}`,
              operatorId: operatorId || 'SYSTEM',
            });

            nextTransactions.push({
              sourceLocationId: allocation.sourceLocationId,
              batchNo: transaction.batchNo ?? allocation.batchNo,
              quantity: allocation.quantity,
              transactionId: transaction.id,
              referenceNo: transaction.referenceNo ?? referenceNo,
            });
          }

          return nextTransactions;
        });

        const quantityToShip = this.round2(
          lineTransactions.reduce(
            (sum, allocation) => sum + Number(allocation.quantity ?? 0),
            0,
          ),
        );

        for (const allocation of lineTransactions) {
          this.eventEmitter.emit('inventory.stock_depleted', {
            companyId,
            idempotencyKey: `stock_depleted:${allocation.transactionId}`,
            transactionId: allocation.transactionId,
            referenceNo: allocation.referenceNo,
            materialId: product.materialId,
            quantity: allocation.quantity,
            operatorId: operatorId || 'SYSTEM',
          });
        }

        postedLines.push({
          productId: product.id,
          materialId: product.materialId,
          requestedQuantity,
          quantity: quantityToShip,
          remainingQuantity: this.round2(
            Math.max(0, quantityRequestedThisRound - quantityToShip),
          ),
          sourceLocationId:
            lineTransactions[0]?.sourceLocationId ??
            payload.sourceLocationId ??
            '',
          batchNo: lineTransactions[0]?.batchNo ?? payload.batchNo ?? '',
          transactionId: lineTransactions[0]?.transactionId ?? '',
          allocations: lineTransactions,
        });

        const currentShipped = shippedQuantityByProductId.get(product.id) ?? 0;
        shippedQuantityByProductId.set(
          product.id,
          this.round2(currentShipped + quantityToShip),
        );
      } catch (error) {
        skippedLines.push({
          productId: product.id,
          requestedQuantity,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalShipped = this.round2(
      [...shippedQuantityByProductId.values()].reduce(
        (sum, quantity) => sum + Number(quantity ?? 0),
        0,
      ),
    );

    if (!postedLines.length) {
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        totalOrdered,
        totalShipped,
        status: order.status,
        postingStatus: 'NO_STOCK_POSTED',
        postedLines,
        skippedLines,
        message: '本次未找到可发货库存，订单状态保持不变',
      };
    }

    const nextStatus =
      totalShipped >= totalOrdered ? 'SHIPPED' : 'PARTIAL_SHIPPED';

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      totalOrdered,
      totalShipped,
      status: nextStatus,
      postingStatus: 'POSTED',
      postedLines,
      skippedLines,
      message:
        nextStatus === 'SHIPPED'
          ? '销售订单自动过账完成，订单状态已更新为 SHIPPED'
          : '销售订单部分发货完成，订单状态已更新为 PARTIAL_SHIPPED',
    };
  }

  async getRealtimeLedger(
    companyId: string,
    pagination: PaginationDto & {
      search?: string;
      warehouseId?: string;
      lowOnly?: string | boolean;
    } = {},
  ): Promise<{
    data: StockLedgerRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(pagination.page ?? 1));
    const requestedLimit = Math.max(1, Number(pagination.limit ?? 50));
    const limit = Math.min(requestedLimit, 200);
    const offset = (page - 1) * limit;
    const search = String(pagination.search ?? '').trim();
    const warehouseId = String(pagination.warehouseId ?? '').trim();
    const lowOnly =
      pagination.lowOnly === true ||
      pagination.lowOnly === 'true' ||
      pagination.lowOnly === '1';

    const { rows, total } = await this.kyselyService.withTenant(async (trx) => {
      const groupByColumns = [
        'loc.id',
        'loc.name',
        'loc.warehouseId',
        'wh.name',
        'mat.id',
        'mat.sku',
        'mat.name',
        'mat.unit',
        'mat.minStock',
      ] as const;

      let baseQuery = trx
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
        .groupBy(groupByColumns)
        .orderBy('wh.name', 'asc')
        .orderBy('loc.name', 'asc')
        .orderBy('mat.name', 'asc');

      if (warehouseId) {
        baseQuery = baseQuery.where('loc.warehouseId', '=', warehouseId);
      }

      if (search) {
        const like = `%${search}%`;
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb('mat.name', 'ilike', like),
            eb('mat.sku', 'ilike', like),
            eb('loc.name', 'ilike', like),
            eb('wh.name', 'ilike', like),
          ]),
        );
      }

      if (lowOnly) {
        baseQuery = baseQuery
          .having(sql`"mat"."minStock"`, '>', 0)
          .having(sql`sum("sq"."quantity")`, '<=', sql`"mat"."minStock"`);
      }

      // Count total grouped rows via subquery
      const countResult = await trx
        .selectFrom(baseQuery.as('sub'))
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .executeTakeFirst();
      const total = Number(countResult?.total ?? 0);

      // Fetch paginated data
      const rows = await baseQuery.limit(limit).offset(offset).execute();

      return { rows: rows as unknown as StockLedgerQueryRow[], total };
    });

    const data = rows.map((row): StockLedgerRow => {
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

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
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
    const availableQuantity = Number(quant.quantity ?? 0);
    if (availableQuantity < data.quantity) {
      throw new BadRequestException(`库存不足，当前余量：${availableQuantity}`);
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
          quantity: Number(move.quantity),
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
        quantity: Number(move.quantity),
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
          quantity: Number(move.quantity),
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
        quantity: Number(move.quantity),
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

  private async resolveShipmentAllocations(
    companyId: string,
    materialId: string,
    requestedQuantity: number,
    sourceLocationId?: string,
    batchNo?: string,
  ) {
    const candidates = await this.prisma.stockQuant.findMany({
      where: {
        materialId,
        quantity: { gt: 0 },
        location: { companyId },
        ...(sourceLocationId ? { locationId: sourceLocationId } : {}),
        ...(batchNo ? { batchNo } : {}),
      },
      orderBy: [
        { updatedAt: 'asc' },
        { batchNo: 'asc' },
        { locationId: 'asc' },
      ],
      select: {
        locationId: true,
        batchNo: true,
        quantity: true,
        location: { select: { name: true } },
      },
    });

    const allocations: Array<{
      sourceLocationId: string;
      batchNo: string;
      quantity: number;
      locationName: string | null;
    }> = [];

    let remaining = this.round2(requestedQuantity);
    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }

      const availableQuantity = this.round2(Number(candidate.quantity ?? 0));
      if (availableQuantity <= 0) {
        continue;
      }

      const quantity = this.round2(Math.min(remaining, availableQuantity));
      if (quantity <= 0) {
        continue;
      }

      allocations.push({
        sourceLocationId: candidate.locationId,
        batchNo: candidate.batchNo,
        quantity,
        locationName: candidate.location?.name ?? null,
      });
      remaining = this.round2(remaining - quantity);
    }

    const allocatedQuantity = this.round2(
      allocations.reduce((sum, item) => sum + item.quantity, 0),
    );

    return {
      allocations,
      requestedQuantity: this.round2(requestedQuantity),
      allocatedQuantity,
      remainingQuantity: this.round2(
        Math.max(0, requestedQuantity - allocatedQuantity),
      ),
    };
  }

  private async resolveShipmentStockCandidate(
    companyId: string,
    materialId: string,
    requestedQuantity: number,
    sourceLocationId?: string,
    batchNo?: string,
  ) {
    const candidate = await this.prisma.stockQuant.findFirst({
      where: {
        materialId,
        quantity: { gt: 0 },
        location: { companyId },
        ...(sourceLocationId ? { locationId: sourceLocationId } : {}),
        ...(batchNo ? { batchNo } : {}),
      },
      orderBy: [{ quantity: 'desc' }, { updatedAt: 'asc' }],
      select: {
        locationId: true,
        batchNo: true,
        quantity: true,
        location: { select: { name: true } },
      },
    });

    if (!candidate) {
      return null;
    }

    return {
      sourceLocationId: candidate.locationId,
      batchNo: candidate.batchNo,
      availableQuantity: Number(candidate.quantity ?? 0),
      locationName: candidate.location?.name ?? null,
      requestedQuantity,
    };
  }

  private round2(value: number) {
    return roundDecimal(value);
  }

  private generateBatchNo() {
    return `BATCH${Date.now()}`;
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

    const transaction = await tx.inventoryTransaction.create({
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
      },
    });

    return {
      ...transaction,
      quantity: Number(transaction.quantity),
    };
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
