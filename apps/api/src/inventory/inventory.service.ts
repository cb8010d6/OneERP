import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
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
  averageCost: number;
  inventoryValue: number;
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
  averageCost: number | string | null;
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
  unitCost?: number;
}

export interface InventoryReturnDocumentRow {
  id: string;
  returnNo: string;
  returnType: string;
  sourceDocumentNo: string;
  referenceNo: string;
  status: string;
  note?: string | null;
  postedAt: Date;
  lines: Array<{
    id: string;
    materialId: string;
    quantity: Prisma.Decimal | number | string;
    locationId?: string | null;
    inventoryMoveId?: string | null;
    batchNo?: string | null;
  }>;
}

export interface ReplenishmentSuggestionRow {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  minStock: number;
  onHandQty: number;
  incomingQty: number;
  projectedQty: number;
  shortageQty: number;
  suggestedPurchaseQty: number;
  unitPrice: number;
  estimatedAmount: number;
  severity: 'OUT_OF_STOCK' | 'SHORTAGE';
}

export interface ReplenishmentSuggestionResult {
  totalSuggestions: number;
  totalShortageQty: number;
  totalEstimatedAmount: number;
  rows: ReplenishmentSuggestionRow[];
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

  async getReplenishmentSuggestions(
    companyId: string,
  ): Promise<ReplenishmentSuggestionResult> {
    const [materials, quants, purchaseLines] = await Promise.all([
      this.prisma.material.findMany({
        where: { OR: [{ companyId }, { companyId: null }] },
        orderBy: [{ category: 'asc' }, { sku: 'asc' }],
      }),
      this.prisma.stockQuant.findMany({
        where: { location: { companyId } },
        select: {
          materialId: true,
          quantity: true,
        },
      }),
      this.prisma.purchaseOrderLine.findMany({
        where: {
          purchaseOrder: {
            companyId,
            status: { in: ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'] },
          },
        },
        select: {
          materialId: true,
          quantity: true,
          receivedQty: true,
        },
      }),
    ]);

    const onHandByMaterial = new Map<string, number>();
    for (const quant of quants) {
      const current = onHandByMaterial.get(quant.materialId) ?? 0;
      onHandByMaterial.set(
        quant.materialId,
        roundDecimal(current + Number(quant.quantity ?? 0)),
      );
    }

    const incomingByMaterial = new Map<string, number>();
    for (const line of purchaseLines) {
      const outstanding = Math.max(
        0,
        Number(line.quantity ?? 0) - Number(line.receivedQty ?? 0),
      );
      const current = incomingByMaterial.get(line.materialId) ?? 0;
      incomingByMaterial.set(
        line.materialId,
        roundDecimal(current + outstanding),
      );
    }

    const rows = materials
      .map((material): ReplenishmentSuggestionRow | null => {
        const minStock = roundDecimal(Number(material.minStock ?? 0));
        if (minStock <= 0) return null;

        const onHandQty = roundDecimal(onHandByMaterial.get(material.id) ?? 0);
        const incomingQty = roundDecimal(
          incomingByMaterial.get(material.id) ?? 0,
        );
        const projectedQty = roundDecimal(onHandQty + incomingQty);
        const shortageQty = roundDecimal(Math.max(0, minStock - projectedQty));
        if (shortageQty <= 0) return null;

        const unitPrice = roundDecimal(Number(material.unitPrice ?? 0));
        return {
          materialId: material.id,
          sku: material.sku,
          name: material.name,
          category: material.category,
          unit: material.unit,
          minStock,
          onHandQty,
          incomingQty,
          projectedQty,
          shortageQty,
          suggestedPurchaseQty: shortageQty,
          unitPrice,
          estimatedAmount: roundDecimal(shortageQty * unitPrice),
          severity: onHandQty <= 0 ? 'OUT_OF_STOCK' : 'SHORTAGE',
        };
      })
      .filter((row): row is ReplenishmentSuggestionRow => Boolean(row))
      .sort(
        (a, b) =>
          b.estimatedAmount - a.estimatedAmount ||
          b.shortageQty - a.shortageQty ||
          a.sku.localeCompare(b.sku),
      );

    return {
      totalSuggestions: rows.length,
      totalShortageQty: roundDecimal(
        rows.reduce((sum, row) => sum + row.shortageQty, 0),
      ),
      totalEstimatedAmount: roundDecimal(
        rows.reduce((sum, row) => sum + row.estimatedAmount, 0),
      ),
      rows,
    };
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

  async getReturnDocuments(companyId: string) {
    return this.prisma.inventoryReturnDocument.findMany({
      where: { companyId },
      include: {
        lines: {
          orderBy: { createdAt: 'asc' },
        },
        creditNote: {
          select: {
            id: true,
            creditNo: true,
            postingStatus: true,
          },
        },
        supplierCreditNote: {
          select: {
            id: true,
            creditNo: true,
            postingStatus: true,
          },
        },
      },
      orderBy: { postedAt: 'desc' },
      take: 50,
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

    const totalOrdered = roundDecimal(
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
        roundDecimal(orderedQuantity - alreadyShippedQuantity),
      );

      if (remainingQuantity <= 0) {
        skippedLines.push({
          productId: product.id,
          requestedQuantity,
          reason: '该订单项已全部发货',
        });
        continue;
      }

      const quantityRequestedThisRound = roundDecimal(
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

        const quantityToShip = roundDecimal(
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
          remainingQuantity: roundDecimal(
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
          roundDecimal(currentShipped + quantityToShip),
        );
      } catch (error) {
        skippedLines.push({
          productId: product.id,
          requestedQuantity,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalShipped = roundDecimal(
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
      let baseQuery = trx
        .selectFrom('InventoryLedgerSnapshot as snap')
        .innerJoin('StockLocation as loc', 'loc.id', 'snap.locationId')
        .innerJoin('Material as mat', 'mat.id', 'snap.materialId')
        .leftJoin('Warehouse as wh', 'wh.id', 'loc.warehouseId')
        .leftJoin('MaterialCost as cost', (join) =>
          join
            .onRef('cost.materialId', '=', 'snap.materialId')
            .on('cost.companyId', '=', companyId),
        )
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
          'snap.netQty as netQty',
          'snap.batchCount as batchCount',
          'cost.averageCost as averageCost',
        ])
        .where('snap.companyId', '=', companyId)
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
          .where('mat.minStock', '>', 0)
          .whereRef('snap.netQty', '<=', 'mat.minStock');
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
      const averageCost = Number(row.averageCost ?? 0);
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
        averageCost,
        inventoryValue: roundDecimal(netQty * averageCost),
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
        unitCost: data.unitCost,
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
        unitCost: transaction.unitCost ?? Number(material?.unitPrice ?? 0),
        operatorId: operatorId || 'SYSTEM',
      });
    }

    return transaction;
  }

  async createStockMoveInTransaction(
    tx: Prisma.TransactionClient,
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

    return this.executeStockMove(tx, {
      companyId,
      materialId: data.materialId,
      quantity: data.quantity,
      sourceLocationId: sourceLocation?.id,
      destLocationId: destLocation?.id,
      batchNo: data.batchNo,
      operatorId: operatorId || 'SYSTEM',
      referenceNo: this.buildReferenceNo(
        data.referenceNo,
        data.documentType,
        data.documentId,
      ),
      note: data.note ?? this.buildMoveNote(data.documentType, data.documentId),
      unitCost: data.unitCost,
    });
  }

  async createInbound(
    companyId: string,
    data: {
      destLocationId: string;
      materialId: string;
      quantity: number;
      batchNo?: string;
      unitCost?: number;
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
        unitCost: data.unitCost,
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
      const returnDocument = await this.findReturnDocumentByReference(
        companyId,
        reverseReferenceNo,
      );
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        reversedLines: [],
        returnDocument,
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
      locationId?: string | null;
      batchNo?: string | null;
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
        locationId: transaction.destLocationId ?? null,
        batchNo: transaction.batchNo ?? null,
      });
    }

    if (options?.rollbackStatus !== false) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'IN_PRODUCTION' },
      });
    }

    const returnDocument = await this.createReturnDocument({
      companyId,
      returnType: 'SALES',
      sourceDocumentId: order.id,
      sourceDocumentNo: order.orderNo,
      referenceNo: reverseReferenceNo,
      note: payload.note ?? `销售订单冲销回库：${order.orderNo}`,
      operatorId,
      lines: reversedLines,
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      reversedLines,
      returnDocument,
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
      const returnDocument = await this.findReturnDocumentByReference(
        companyId,
        reverseReferenceNo,
      );
      return {
        purchaseNo,
        reversedLines: [],
        returnDocument,
        message: '采购入库冲销已存在，已跳过重复处理',
      };
    }

    const inboundMoves = await this.prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        OR: [
          { referenceNo: purchaseReferenceNo },
          { referenceNo: { startsWith: `${purchaseReferenceNo}-` } },
        ],
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
      locationId?: string | null;
      batchNo?: string | null;
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
        locationId: transaction.sourceLocationId ?? null,
        batchNo: transaction.batchNo ?? null,
      });
    }

    const returnDocument = await this.createReturnDocument({
      companyId,
      returnType: 'PURCHASE',
      sourceDocumentNo: purchaseNo,
      referenceNo: reverseReferenceNo,
      note: payload.note ?? `采购入库冲销：${purchaseNo}`,
      operatorId,
      lines: reversedLines,
    });

    return {
      purchaseNo,
      reversedLines,
      returnDocument,
      message: '采购入库冲销完成',
    };
  }

  private async findReturnDocumentByReference(
    companyId: string,
    referenceNo: string,
  ) {
    return this.prisma.inventoryReturnDocument.findUnique({
      where: { companyId_referenceNo: { companyId, referenceNo } },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private async createReturnDocument(input: {
    companyId: string;
    returnType: 'SALES' | 'PURCHASE';
    sourceDocumentId?: string;
    sourceDocumentNo: string;
    referenceNo: string;
    note?: string;
    operatorId?: string;
    lines: Array<{
      materialId: string;
      quantity: number;
      transactionId: string;
      locationId?: string | null;
      batchNo?: string | null;
    }>;
  }) {
    return this.prisma.inventoryReturnDocument.upsert({
      where: {
        companyId_referenceNo: {
          companyId: input.companyId,
          referenceNo: input.referenceNo,
        },
      },
      update: {
        note: input.note,
        status: 'POSTED',
      },
      create: {
        returnNo: this.generateReturnNo(input.returnType),
        returnType: input.returnType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentNo: input.sourceDocumentNo,
        referenceNo: input.referenceNo,
        status: 'POSTED',
        note: input.note,
        operatorId: input.operatorId,
        companyId: input.companyId,
        lines: {
          create: input.lines.map((line) => ({
            materialId: line.materialId,
            quantity: line.quantity,
            locationId: line.locationId,
            inventoryMoveId: line.transactionId,
            batchNo: line.batchNo,
          })),
        },
      },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private generateReturnNo(returnType: 'SALES' | 'PURCHASE') {
    const prefix = returnType === 'SALES' ? 'SR' : 'PR';
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    return `${prefix}-${date}-${String(now.getTime()).slice(-6)}`;
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

    let remaining = roundDecimal(requestedQuantity);
    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }

      const availableQuantity = roundDecimal(Number(candidate.quantity ?? 0));
      if (availableQuantity <= 0) {
        continue;
      }

      const quantity = roundDecimal(Math.min(remaining, availableQuantity));
      if (quantity <= 0) {
        continue;
      }

      allocations.push({
        sourceLocationId: candidate.locationId,
        batchNo: candidate.batchNo,
        quantity,
        locationName: candidate.location?.name ?? null,
      });
      remaining = roundDecimal(remaining - quantity);
    }

    const allocatedQuantity = roundDecimal(
      allocations.reduce((sum, item) => sum + item.quantity, 0),
    );

    return {
      allocations,
      requestedQuantity: roundDecimal(requestedQuantity),
      allocatedQuantity,
      remainingQuantity: roundDecimal(
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

  private round4(value: Decimal.Value) {
    return roundDecimal(value, 4);
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
      unitCost?: number;
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

    if (input.sourceLocationId) {
      await this.refreshLedgerSnapshot(tx, {
        companyId: input.companyId,
        locationId: input.sourceLocationId,
        materialId: input.materialId,
      });
    }

    if (input.destLocationId) {
      await this.refreshLedgerSnapshot(tx, {
        companyId: input.companyId,
        locationId: input.destLocationId,
        materialId: input.materialId,
      });
    }

    const moveType =
      input.sourceLocationId && input.destLocationId
        ? 'TRANSFER'
        : input.sourceLocationId
          ? 'OUTBOUND'
          : 'INBOUND';
    const unitCost = await this.updateMaterialCost(tx, {
      companyId: input.companyId,
      materialId: input.materialId,
      quantity: input.quantity,
      moveType,
      unitCost: input.unitCost,
    });

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
      unitCost,
    };
  }

  private async updateMaterialCost(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      materialId: string;
      quantity: number;
      moveType: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
      unitCost?: number;
    },
  ) {
    if (input.moveType === 'TRANSFER') {
      return this.resolveMovingAverageCost(
        tx,
        input.companyId,
        input.materialId,
      );
    }

    const existing = await tx.materialCost.findUnique({
      where: {
        companyId_materialId: {
          companyId: input.companyId,
          materialId: input.materialId,
        },
      },
    });
    const fallbackUnitCost = await this.resolveMaterialFallbackCost(
      tx,
      input.materialId,
    );
    const currentQty = new Decimal(existing?.quantityOnHand ?? 0);
    const currentValue = new Decimal(
      existing?.inventoryValue ??
        currentQty.times(existing?.averageCost ?? fallbackUnitCost),
    );
    const currentAverageCost = currentQty.gt(0)
      ? currentValue.div(currentQty)
      : new Decimal(existing?.averageCost ?? fallbackUnitCost);
    const moveQty = new Decimal(input.quantity);

    if (input.moveType === 'INBOUND') {
      const incomingUnitCost = new Decimal(input.unitCost ?? fallbackUnitCost);
      const nextQty = currentQty.plus(moveQty);
      const nextValue = currentValue.plus(moveQty.times(incomingUnitCost));
      const nextAverageCost = nextQty.gt(0)
        ? nextValue.div(nextQty)
        : incomingUnitCost;
      await tx.materialCost.upsert({
        where: {
          companyId_materialId: {
            companyId: input.companyId,
            materialId: input.materialId,
          },
        },
        create: {
          companyId: input.companyId,
          materialId: input.materialId,
          quantityOnHand: this.round4(nextQty),
          averageCost: this.round4(nextAverageCost),
          inventoryValue: this.round4(nextValue),
        },
        update: {
          quantityOnHand: this.round4(nextQty),
          averageCost: this.round4(nextAverageCost),
          inventoryValue: this.round4(nextValue),
        },
      });
      return this.round4(incomingUnitCost);
    }

    const issuedUnitCost = currentAverageCost;
    const nextQty = Decimal.max(0, currentQty.minus(moveQty));
    const nextValue = nextQty.eq(0)
      ? new Decimal(0)
      : Decimal.max(0, currentValue.minus(moveQty.times(issuedUnitCost)));
    const nextAverageCost = nextQty.gt(0)
      ? nextValue.div(nextQty)
      : issuedUnitCost;

    await tx.materialCost.upsert({
      where: {
        companyId_materialId: {
          companyId: input.companyId,
          materialId: input.materialId,
        },
      },
      create: {
        companyId: input.companyId,
        materialId: input.materialId,
        quantityOnHand: this.round4(nextQty),
        averageCost: this.round4(nextAverageCost),
        inventoryValue: this.round4(nextValue),
      },
      update: {
        quantityOnHand: this.round4(nextQty),
        averageCost: this.round4(nextAverageCost),
        inventoryValue: this.round4(nextValue),
      },
    });

    return this.round4(issuedUnitCost);
  }

  private async resolveMovingAverageCost(
    tx: Prisma.TransactionClient,
    companyId: string,
    materialId: string,
  ) {
    const cost = await tx.materialCost.findUnique({
      where: { companyId_materialId: { companyId, materialId } },
      select: { averageCost: true },
    });
    if (cost) return Number(cost.averageCost);
    return this.resolveMaterialFallbackCost(tx, materialId);
  }

  private async resolveMaterialFallbackCost(
    tx: Prisma.TransactionClient,
    materialId: string,
  ) {
    const material = await tx.material.findFirst({
      where: { id: materialId },
      select: { unitPrice: true },
    });
    return Number(material?.unitPrice ?? 0);
  }

  private async refreshLedgerSnapshot(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      locationId: string;
      materialId: string;
    },
  ) {
    const [quantityAgg, batchCount] = await Promise.all([
      tx.stockQuant.aggregate({
        where: {
          locationId: input.locationId,
          materialId: input.materialId,
        },
        _sum: { quantity: true },
      }),
      tx.stockQuant.count({
        where: {
          locationId: input.locationId,
          materialId: input.materialId,
          quantity: { not: 0 },
        },
      }),
    ]);

    const netQty = quantityAgg._sum.quantity ?? 0;

    if (batchCount === 0 && Number(netQty) === 0) {
      await tx.inventoryLedgerSnapshot.deleteMany({
        where: {
          companyId: input.companyId,
          locationId: input.locationId,
          materialId: input.materialId,
        },
      });
      return;
    }

    await tx.inventoryLedgerSnapshot.upsert({
      where: {
        companyId_locationId_materialId: {
          companyId: input.companyId,
          locationId: input.locationId,
          materialId: input.materialId,
        },
      },
      create: {
        companyId: input.companyId,
        locationId: input.locationId,
        materialId: input.materialId,
        netQty,
        batchCount,
        refreshedAt: new Date(),
      },
      update: {
        netQty,
        batchCount,
        refreshedAt: new Date(),
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
