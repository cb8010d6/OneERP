import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { KyselyService } from '../core/prisma/kysely.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { EventQueueService } from '../core/events/event-queue.service';
import { nextDocumentTimestamp } from '../core/utils/document-timestamp';
import { roundDecimal } from '../core/utils/decimal';
import { withUniqueConstraintRetry } from '../core/utils/prisma-unique-retry';
import {
  CreateStockMoveDto,
  PurchaseInboundPostingDto,
  ReversePurchaseInboundDto,
  ReverseSaleOrderShipmentDto,
  SaleOrderShipmentDto,
} from './dto/inventory.dto';
import { StockQueryService } from './stock-query.service';

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

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private readonly kyselyService: KyselyService,
    private readonly eventQueueService: EventQueueService,
    private readonly stockQueryService: StockQueryService,
  ) {}

  async getCompanyStocks(companyId: string, pagination: PaginationDto) {
    return this.stockQueryService.getCompanyStocks(companyId, pagination);
  }

  async getWarehouses(companyId: string) {
    return this.stockQueryService.getWarehouses(companyId);
  }

  async getLocations(companyId: string, warehouseId?: string) {
    return this.stockQueryService.getLocations(companyId, warehouseId);
  }

  async getMaterials(companyId: string) {
    return this.stockQueryService.getMaterials(companyId);
  }

  async getReplenishmentSuggestions(companyId: string) {
    return this.stockQueryService.getReplenishmentSuggestions(companyId);
  }

  async getTransactions(companyId: string) {
    return this.stockQueryService.getTransactions(companyId);
  }

  async getReturnDocuments(companyId: string) {
    return this.stockQueryService.getReturnDocuments(companyId);
  }

  async getRealtimeLedger(
    companyId: string,
    pagination: PaginationDto & {
      search?: string;
      warehouseId?: string;
      lowOnly?: string | boolean;
    } = {},
  ) {
    return this.stockQueryService.getRealtimeLedger(companyId, pagination);
  }

  async postSaleOrderShipment(
    companyId: string,
    orderId: string,
    payload: SaleOrderShipmentDto,
    operatorId?: string,
  ) {
    if (!payload.items?.length) {
      throw new BadRequestException('销售订单发货明细不能为空');
    }
    // Reject rather than silently merging quantities: both posting modes must
    // agree on what the caller explicitly requested before any line can commit.
    const requestedProducts = new Set<string>();
    for (const item of payload.items) {
      if (requestedProducts.has(item.productId)) {
        throw new BadRequestException(
          '发货明细不能重复指定同一产品，请合并该产品数量后重试',
        );
      }
      requestedProducts.add(item.productId);
    }

    type Outcome = Awaited<ReturnType<InventoryService['postShipmentBatch']>>;
    const skippedLines: Array<{
      productId: string;
      requestedQuantity: number;
      reason: string;
    }> = [];
    let outcome: Outcome;
    if (!payload.allowPartial) {
      outcome = await this.withShipmentTransaction((tx) =>
        this.postShipmentBatch(tx, companyId, orderId, payload, operatorId),
      );
      await this.dispatchQueuedEvents(outcome.queuedEventIds);
    } else {
      const postedLines: Outcome['postedLines'] = [];
      const queuedEventIds: string[] = [];
      for (const item of payload.items) {
        let line: Outcome;
        try {
          line = await this.withShipmentTransaction((tx) =>
            this.postShipmentBatch(
              tx,
              companyId,
              orderId,
              { ...payload, items: [item] },
              operatorId,
            ),
          );
        } catch (error) {
          skippedLines.push({
            productId: item.productId,
            requestedQuantity: Number.isFinite(Number(item.shipQuantity))
              ? Number(item.shipQuantity)
              : 0,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        postedLines.push(...line.postedLines);
        queuedEventIds.push(...line.queuedEventIds);
        // A delivery failure is not a skipped shipment. The committed movement,
        // order state and durable outbox must never be retried as a new write.
        await this.dispatchQueuedEvents(line.queuedEventIds);
      }
      const final = await this.withShipmentTransaction((tx) =>
        this.loadShipmentBalance(tx, companyId, orderId),
      );
      outcome = {
        orderId: final.order.id,
        orderNo: final.order.orderNo,
        totalOrdered: final.totalOrdered,
        totalShipped: final.totalShipped,
        status: final.order.status,
        postedLines,
        queuedEventIds,
      };
    }

    const result = {
      orderId: outcome.orderId,
      orderNo: outcome.orderNo,
      totalOrdered: outcome.totalOrdered,
      totalShipped: outcome.totalShipped,
      status: outcome.status,
      postedLines: outcome.postedLines,
    };
    return {
      ...result,
      postingStatus: result.postedLines.length ? 'POSTED' : 'NO_STOCK_POSTED',
      skippedLines,
      message: !result.postedLines.length
        ? '本次未找到可发货库存，订单状态保持不变'
        : result.status === 'SHIPPED'
          ? '销售订单自动过账完成，订单状态已更新为 SHIPPED'
          : '销售订单部分发货完成，订单状态已更新为 PARTIAL_SHIPPED',
    };
  }

  private async withShipmentTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        ) {
          throw error;
        }
        if (attempt >= 2) {
          throw new ConflictException('发货数据存在并发修改，请刷新后重试');
        }
        // Only a rolled-back serialization/deadlock conflict is replayed.
        // Reads, validation and outbox insertion all restart with a new snapshot.
      }
    }
  }

  private async loadShipmentBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    orderId: string,
  ) {
    const order = await tx.order.findFirst({
      where: { id: orderId, companyId },
      include: { items: { select: { productId: true, quantity: true } } },
    });
    if (!order) {
      throw new NotFoundException('销售订单不存在或无权限访问');
    }
    if (!order.items.length) {
      throw new BadRequestException('销售订单无明细，无法自动过账');
    }
    const products = await tx.product.findMany({
      where: {
        companyId,
        id: { in: [...new Set(order.items.map((item) => item.productId))] },
      },
      select: {
        id: true,
        materialId: true,
        name: true,
        sku: true,
        material: { select: { companyId: true } },
      },
    });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    const orderedByProduct = new Map<string, number>();
    const productIdsByMaterial = new Map<string, Set<string>>();
    const orderedByMaterial = new Map<string, number>();
    for (const item of order.items) {
      orderedByProduct.set(
        item.productId,
        this.round4(
          (orderedByProduct.get(item.productId) ?? 0) + Number(item.quantity),
        ),
      );
      const materialId = productById.get(item.productId)?.materialId;
      if (!materialId) continue;
      const productIds =
        productIdsByMaterial.get(materialId) ?? new Set<string>();
      productIds.add(item.productId);
      productIdsByMaterial.set(materialId, productIds);
      orderedByMaterial.set(
        materialId,
        this.round4(
          (orderedByMaterial.get(materialId) ?? 0) + Number(item.quantity),
        ),
      );
    }

    const { referenceNo, shippedByMaterial } =
      await this.loadNetShipmentQuantities(tx, companyId, order);
    for (const [materialId, shipped] of shippedByMaterial) {
      if (shipped < 0 || shipped > (orderedByMaterial.get(materialId) ?? 0)) {
        throw new BadRequestException(
          '销售出库净数量与当前订单物料需求不一致，请核对产品映射及出库/冲销流水后重试',
        );
      }
    }
    return {
      order,
      referenceNo,
      productById,
      orderedByProduct,
      orderedByMaterial,
      productIdsByMaterial,
      shippedByMaterial,
      totalOrdered: this.round4(
        order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
      ),
      totalShipped: this.round4(
        [...shippedByMaterial.values()].reduce((sum, qty) => sum + qty, 0),
      ),
    };
  }

  // Also used by reversal: deliberately independent of current product mapping
  // and demand caps, so historical over-shipment can still be corrected.
  private async loadNetShipmentQuantities(
    tx: Prisma.TransactionClient,
    companyId: string,
    order: { id: string; orderNo: string },
  ) {
    const referenceNo = `SALE-SHIP-${order.orderNo}`;
    const reversePrefix = `SALE-SHIP-REV-${order.orderNo}`;
    const moves = await tx.inventoryTransaction.findMany({
      where: {
        companyId,
        OR: [
          { referenceNo, type: 'OUTBOUND' },
          { referenceNo: reversePrefix, type: 'INBOUND' },
          { referenceNo: { startsWith: `${reversePrefix}-` }, type: 'INBOUND' },
        ],
      },
      select: {
        id: true,
        materialId: true,
        quantity: true,
        type: true,
        referenceNo: true,
      },
    });
    const reversalIds = moves
      .filter((move) => move.type === 'INBOUND')
      .map((move) => move.id);
    const returns = reversalIds.length
      ? await tx.inventoryReturnDocument.findMany({
          where: {
            companyId,
            returnType: 'SALES',
            status: 'POSTED',
            lines: { some: { inventoryMoveId: { in: reversalIds } } },
          },
          select: {
            sourceDocumentId: true,
            lines: { select: { inventoryMoveId: true } },
          },
        })
      : [];
    const shippedByMaterial = new Map<string, number>();
    for (const move of moves) {
      if (move.type === 'INBOUND') {
        const owners = new Set(
          returns
            .filter((document) =>
              document.lines.some((line) => line.inventoryMoveId === move.id),
            )
            .map((document) => document.sourceDocumentId),
        );
        if (owners.size !== 1 || owners.has(null)) {
          throw new BadRequestException(
            '销售冲销流水缺少唯一的销售退货单归属，请核对冲销流水后重试',
          );
        }
        if (!owners.has(order.id)) continue;
      }
      shippedByMaterial.set(
        move.materialId,
        this.round4(
          (shippedByMaterial.get(move.materialId) ?? 0) +
            (move.type === 'INBOUND' ? -1 : 1) * Number(move.quantity),
        ),
      );
    }
    return { referenceNo, shippedByMaterial };
  }

  private async postShipmentBatch(
    tx: Prisma.TransactionClient,
    companyId: string,
    orderId: string,
    payload: SaleOrderShipmentDto,
    operatorId?: string,
  ) {
    const balance = await this.loadShipmentBalance(tx, companyId, orderId);
    const {
      order,
      referenceNo,
      productById,
      orderedByProduct,
      shippedByMaterial,
    } = balance;
    const sharedMaterialMessage =
      '多个订单产品共用物料，无法按产品确认剩余发货数量。仅支持净已发为零时关闭 allowPartial，按订单数量一次提交该物料全部产品；已有部分出库请人工核对，仅确需纠正的出库可按现有流程冲销，不得为绕过校验虚假回库';
    // A ledger movement has a material, not an order-item/product identity.
    // Shared-material products are safe only as a complete atomic group from
    // zero net delivery. Never guess which product a legacy partial move served.
    for (const item of payload.items) {
      const product = productById.get(item.productId);
      if (!product?.materialId) continue;
      const group =
        balance.productIdsByMaterial.get(product.materialId) ??
        new Set<string>();
      if (group.size <= 1) continue;
      const shipped = shippedByMaterial.get(product.materialId) ?? 0;
      if (shipped >= (balance.orderedByMaterial.get(product.materialId) ?? 0)) {
        throw new BadRequestException(
          `产品 ${product.name} 所属物料组已全部发货`,
        );
      }
      if (
        payload.allowPartial ||
        shipped !== 0 ||
        [...group].some(
          (productId) =>
            payload.items.find((request) => request.productId === productId)
              ?.shipQuantity !== orderedByProduct.get(productId),
        )
      ) {
        throw new BadRequestException(sharedMaterialMessage);
      }
    }

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
    const queuedEventIds: string[] = [];
    for (const request of payload.items) {
      const requestedQuantity = Number(request.shipQuantity);
      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
        throw new BadRequestException('发货数量必须大于0');
      }
      const product = productById.get(request.productId);
      if (!product) throw new BadRequestException('销售订单中不存在该产品');
      if (!product.materialId) {
        throw new BadRequestException(
          `产品 ${product.name} 未绑定主物料，无法发货`,
        );
      }
      if (
        !product.material ||
        (product.material.companyId !== null &&
          product.material.companyId !== companyId)
      ) {
        throw new BadRequestException('产品关联物料不存在或不属于当前公司');
      }
      const shared =
        (balance.productIdsByMaterial.get(product.materialId)?.size ?? 0) > 1;
      const alreadyShipped = shared
        ? 0
        : (shippedByMaterial.get(product.materialId) ?? 0);
      const remaining = this.round4(
        (orderedByProduct.get(product.id) ?? 0) - alreadyShipped,
      );
      if (remaining <= 0) {
        throw new BadRequestException(`产品 ${product.name} 已全部发货`);
      }
      if (!payload.allowPartial && requestedQuantity > remaining) {
        throw new BadRequestException(
          `产品 ${product.name} 请求发货 ${requestedQuantity}，订单剩余可发 ${remaining}`,
        );
      }
      const quantityRequestedThisRound = this.round4(
        Math.min(requestedQuantity, remaining),
      );
      const plan = await this.resolveShipmentAllocations(
        tx,
        companyId,
        product.materialId,
        quantityRequestedThisRound,
        payload.sourceLocationId,
        payload.batchNo,
      );
      if (
        !payload.allowPartial &&
        plan.allocatedQuantity < quantityRequestedThisRound
      ) {
        throw new BadRequestException(
          `库存不足：产品 ${product.name} 请求发货 ${requestedQuantity}，当前可发 ${plan.allocatedQuantity}；如需部分发货请显式设置 allowPartial=true`,
        );
      }
      if (plan.allocatedQuantity <= 0) {
        throw new BadRequestException('当前库存不足，最大可发货量为 0');
      }
      const allocations: (typeof postedLines)[number]['allocations'] = [];
      for (const allocation of plan.allocations) {
        const transaction = await this.executeStockMove(tx, {
          companyId,
          sourceLocationId: allocation.sourceLocationId,
          materialId: product.materialId,
          quantity: allocation.quantity,
          batchNo: allocation.batchNo,
          referenceNo,
          note: payload.note ?? `销售订单自动出库：${order.orderNo}`,
          operatorId: operatorId || 'SYSTEM',
        });
        const event = await this.queueStockDepletedInTransaction(
          tx,
          companyId,
          transaction,
          operatorId,
        );
        if (event?.id) queuedEventIds.push(event.id);
        allocations.push({
          sourceLocationId: allocation.sourceLocationId,
          batchNo: transaction.batchNo ?? allocation.batchNo,
          quantity: allocation.quantity,
          transactionId: transaction.id,
        });
      }
      const quantity = this.round4(
        allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
      );
      shippedByMaterial.set(
        product.materialId,
        this.round4(
          (shippedByMaterial.get(product.materialId) ?? 0) + quantity,
        ),
      );
      postedLines.push({
        productId: product.id,
        materialId: product.materialId,
        requestedQuantity,
        quantity,
        remainingQuantity: this.round4(quantityRequestedThisRound - quantity),
        sourceLocationId: allocations[0].sourceLocationId,
        batchNo: allocations[0].batchNo,
        transactionId: allocations[0].transactionId,
        allocations,
      });
    }

    const totalShipped = this.round4(
      [...shippedByMaterial.values()].reduce((sum, qty) => sum + qty, 0),
    );
    const status =
      totalShipped >= balance.totalOrdered ? 'SHIPPED' : 'PARTIAL_SHIPPED';
    await tx.order.update({ where: { id: order.id }, data: { status } });
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      totalOrdered: balance.totalOrdered,
      totalShipped,
      status,
      postedLines,
      queuedEventIds,
    };
  }

  async createStockMove(
    companyId: string,
    data: CreateStockMoveDto,
    operatorId?: string,
  ): Promise<InventoryTransactionRecord> {
    const sourceLocation = await this.resolveLocationOwnership(
      this.prisma,
      companyId,
      data.sourceLocationId,
      '来源库位',
    );
    const destLocation = await this.resolveLocationOwnership(
      this.prisma,
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

    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.executeStockMove(tx, {
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
      });
      const queuedEvent = await this.queueStockDepletedInTransaction(
        tx,
        companyId,
        transaction,
        operatorId,
        Number(material?.unitPrice ?? 0),
      );
      return { transaction, queuedEventId: queuedEvent?.id ?? null };
    });

    if (result.queuedEventId) {
      await this.eventQueueService.dispatchById(result.queuedEventId);
    }

    return result.transaction;
  }

  async createStockMoveInTransaction(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: CreateStockMoveDto,
    operatorId?: string,
  ): Promise<InventoryTransactionRecord> {
    const sourceLocation = await this.resolveLocationOwnership(
      tx,
      companyId,
      data.sourceLocationId,
      '来源库位',
    );
    const destLocation = await this.resolveLocationOwnership(
      tx,
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

  async queueStockDepletedInTransaction(
    tx: Prisma.TransactionClient,
    companyId: string,
    transaction: InventoryTransactionRecord,
    operatorId?: string,
    fallbackUnitCost = 0,
  ) {
    if (transaction.type !== 'OUTBOUND') return null;
    return this.eventQueueService.enqueueInTransaction(tx, {
      eventName: 'inventory.stock_depleted',
      idempotencyKey: `stock_depleted:${transaction.id}`,
      companyId,
      payload: {
        companyId,
        idempotencyKey: `stock_depleted:${transaction.id}`,
        transactionId: transaction.id,
        referenceNo: transaction.referenceNo,
        materialId: transaction.materialId,
        quantity: transaction.quantity,
        unitCost: transaction.unitCost ?? fallbackUnitCost,
        operatorId: operatorId || 'SYSTEM',
      },
    });
  }

  async dispatchQueuedEvents(eventIds: string[]) {
    for (const eventId of eventIds) {
      await this.eventQueueService.dispatchById(eventId);
    }
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

    const referenceNo = `SCAN-${nextDocumentTimestamp()}`;
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

  /**
   * @deprecated 当前版本已改为过账即生效，无需审批。保留端点以兼容旧客户端，后续版本将移除。
   */
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
    const result = await this.withShipmentTransaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId },
        select: { id: true, orderNo: true },
      });

      if (!order) {
        throw new NotFoundException('销售订单不存在或无权限访问');
      }

      const shipmentReferenceNo = `SALE-SHIP-${order.orderNo}`;
      const reverseReferencePrefix = `SALE-SHIP-REV-${order.orderNo}`;

      const latestReturn = await tx.inventoryReturnDocument.findFirst({
        where: {
          companyId,
          returnType: 'SALES',
          sourceDocumentId: order.id,
        },
        select: { referenceNo: true, postedAt: true },
        orderBy: { postedAt: 'desc' },
      });
      if (latestReturn) {
        const ambiguousMoves = await tx.inventoryTransaction.count({
          where: {
            companyId,
            referenceNo: shipmentReferenceNo,
            type: 'OUTBOUND',
            createdAt: latestReturn.postedAt,
          },
        });
        if (ambiguousMoves > 0) {
          throw new BadRequestException(
            '出库与最近销售冲销处于同一毫秒，无法确定冲销边界，请核对原始出库与退货单后重试',
          );
        }
      }

      const shippedMoves = await tx.inventoryTransaction.findMany({
        where: {
          companyId,
          referenceNo: shipmentReferenceNo,
          type: 'OUTBOUND',
          ...(latestReturn ? { createdAt: { gt: latestReturn.postedAt } } : {}),
        },
        select: {
          materialId: true,
          quantity: true,
          sourceLocationId: true,
          batchNo: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const { shippedByMaterial } = await this.loadNetShipmentQuantities(
        tx,
        companyId,
        order,
      );
      const selectedByMaterial = new Map<string, number>();
      for (const move of shippedMoves) {
        selectedByMaterial.set(
          move.materialId,
          this.round4(
            (selectedByMaterial.get(move.materialId) ?? 0) +
              Number(move.quantity),
          ),
        );
      }
      const materialIds = new Set([
        ...shippedByMaterial.keys(),
        ...selectedByMaterial.keys(),
      ]);
      if (
        [...materialIds].some(
          (materialId) =>
            (shippedByMaterial.get(materialId) ?? 0) !==
            (selectedByMaterial.get(materialId) ?? 0),
        )
      ) {
        throw new BadRequestException(
          '销售出库与冲销的数量边界不一致，无法安全确定待冲销流水，请核对原始出库与退货单后重试',
        );
      }

      if (!shippedMoves.length && latestReturn) {
        const returnDocument = await this.findReturnDocumentByReference(
          companyId,
          latestReturn.referenceNo,
          tx,
        );
        return { order, alreadyReversed: true as const, returnDocument };
      }

      if (!shippedMoves.length) {
        throw new BadRequestException('未找到可冲销的销售出库流水');
      }

      const reversalCount = await tx.inventoryReturnDocument.count({
        where: {
          companyId,
          returnType: 'SALES',
          sourceDocumentId: order.id,
        },
      });
      let reverseReferenceNo =
        reversalCount === 0
          ? reverseReferencePrefix
          : `${reverseReferencePrefix}-${reversalCount + 1}`;
      const referenceOwner = await tx.inventoryReturnDocument.findUnique({
        where: {
          companyId_referenceNo: { companyId, referenceNo: reverseReferenceNo },
        },
        select: { sourceDocumentId: true },
      });
      if (referenceOwner) {
        reverseReferenceNo = `${reverseReferencePrefix}-${order.id}-${reversalCount + 1}`;
        const fallbackOwner = await tx.inventoryReturnDocument.findUnique({
          where: {
            companyId_referenceNo: {
              companyId,
              referenceNo: reverseReferenceNo,
            },
          },
          select: { id: true },
        });
        if (fallbackOwner)
          throw new ConflictException(
            '销售冲销单号已被使用，请核对退货单后重试',
          );
      }

      const reversedLines: Array<{
        materialId: string;
        quantity: number;
        transactionId: string;
        locationId?: string | null;
        batchNo?: string | null;
      }> = [];

      for (const move of shippedMoves) {
        const material = await tx.material.findUnique({
          where: { id: move.materialId },
          select: { companyId: true },
        });
        if (
          !material ||
          (material.companyId !== null && material.companyId !== companyId)
        ) {
          throw new BadRequestException(
            '销售出库流水关联物料不存在或不属于当前公司',
          );
        }
        const transaction = await this.createStockMoveInTransaction(
          tx,
          companyId,
          {
            materialId: move.materialId,
            quantity: Number(move.quantity),
            destLocationId:
              payload.destLocationId ?? move.sourceLocationId ?? undefined,
            batchNo: payload.batchNo ?? move.batchNo ?? undefined,
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
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'IN_PRODUCTION' },
        });
      }

      const returnDocument = await this.createReturnDocument(
        {
          companyId,
          returnType: 'SALES',
          sourceDocumentId: order.id,
          sourceDocumentNo: order.orderNo,
          referenceNo: reverseReferenceNo,
          note: payload.note ?? `销售订单冲销回库：${order.orderNo}`,
          operatorId,
          lines: reversedLines,
        },
        tx,
      );

      return {
        order,
        alreadyReversed: false as const,
        reversedLines,
        returnDocument,
      };
    });
    const { order } = result;

    if (result.alreadyReversed) {
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        reversedLines: [],
        returnDocument: result.returnDocument,
        message: '销售订单冲销已存在，已跳过重复处理',
      };
    }

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      reversedLines: result.reversedLines,
      returnDocument: result.returnDocument,
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

    const result = await this.prisma.$transaction(
      async (tx) => {
        const existedReverse = await tx.inventoryTransaction.count({
          where: { companyId, referenceNo: reverseReferenceNo },
        });

        if (existedReverse > 0) {
          const returnDocument = await this.findReturnDocumentByReference(
            companyId,
            reverseReferenceNo,
            tx,
          );
          return {
            alreadyReversed: true as const,
            returnDocument,
            queuedEventIds: [] as string[],
          };
        }

        const inboundMoves = await tx.inventoryTransaction.findMany({
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
          orderBy: { createdAt: 'asc' },
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
        const queuedEventIds: string[] = [];

        for (const move of inboundMoves) {
          const transaction = await this.createStockMoveInTransaction(
            tx,
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
          const material = await tx.material.findFirst({
            where: { id: move.materialId },
            select: { unitPrice: true },
          });
          const queuedEvent = await this.queueStockDepletedInTransaction(
            tx,
            companyId,
            transaction,
            operatorId,
            Number(material?.unitPrice ?? 0),
          );
          if (queuedEvent?.id) queuedEventIds.push(queuedEvent.id);

          reversedLines.push({
            materialId: move.materialId,
            quantity: Number(move.quantity),
            transactionId: transaction.id,
            locationId: transaction.sourceLocationId ?? null,
            batchNo: transaction.batchNo ?? null,
          });
        }

        const returnDocument = await this.createReturnDocument(
          {
            companyId,
            returnType: 'PURCHASE',
            sourceDocumentNo: purchaseNo,
            referenceNo: reverseReferenceNo,
            note: payload.note ?? `采购入库冲销：${purchaseNo}`,
            operatorId,
            lines: reversedLines,
          },
          tx,
        );

        return {
          alreadyReversed: false as const,
          reversedLines,
          returnDocument,
          queuedEventIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    for (const eventId of result.queuedEventIds) {
      await this.eventQueueService.dispatchById(eventId);
    }

    if (result.alreadyReversed) {
      return {
        purchaseNo,
        reversedLines: [],
        returnDocument: result.returnDocument,
        message: '采购入库冲销已存在，已跳过重复处理',
      };
    }

    return {
      purchaseNo,
      reversedLines: result.reversedLines,
      returnDocument: result.returnDocument,
      message: '采购入库冲销完成',
    };
  }

  private async findReturnDocumentByReference(
    companyId: string,
    referenceNo: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return client.inventoryReturnDocument.findUnique({
      where: { companyId_referenceNo: { companyId, referenceNo } },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private async createReturnDocument(
    input: {
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
    },
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (client !== this.prisma) {
      return client.inventoryReturnDocument.upsert({
        where: {
          companyId_referenceNo: {
            companyId: input.companyId,
            referenceNo: input.referenceNo,
          },
        },
        update: { note: input.note, status: 'POSTED' },
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

    return withUniqueConstraintRetry(
      (attempt) =>
        client.inventoryReturnDocument.upsert({
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
            returnNo: this.generateReturnNo(input.returnType, attempt),
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
        }),
      { targetFields: ['returnNo'] },
    );
  }

  private generateReturnNo(returnType: 'SALES' | 'PURCHASE', attempt = 0) {
    const prefix = returnType === 'SALES' ? 'SR' : 'PR';
    const timestamp = nextDocumentTimestamp(attempt);
    const now = new Date(timestamp);
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    return `${prefix}-${date}-${String(timestamp).slice(-6)}`;
  }

  private async resolveLocationOwnership(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    locationId: string | undefined,
    label: string,
  ) {
    if (!locationId) return undefined;

    const location = await client.stockLocation.findFirst({
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
      return `${documentType}-${documentId}-${nextDocumentTimestamp()}`;
    }
    return undefined;
  }

  private buildMoveNote(documentType?: string, documentId?: string) {
    if (!documentType || !documentId) return undefined;
    return `自动过账：${documentType}#${documentId}`;
  }

  private async resolveShipmentAllocations(
    tx: Prisma.TransactionClient,
    companyId: string,
    materialId: string,
    requestedQuantity: number,
    sourceLocationId?: string,
    batchNo?: string,
  ) {
    const candidates = await tx.stockQuant.findMany({
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

    let remaining = this.round4(requestedQuantity);
    for (const candidate of candidates) {
      if (remaining <= 0) {
        break;
      }

      const availableQuantity = this.round4(Number(candidate.quantity ?? 0));
      if (availableQuantity <= 0) {
        continue;
      }

      const quantity = this.round4(Math.min(remaining, availableQuantity));
      if (quantity <= 0) {
        continue;
      }

      allocations.push({
        sourceLocationId: candidate.locationId,
        batchNo: candidate.batchNo,
        quantity,
        locationName: candidate.location?.name ?? null,
      });
      remaining = this.round4(remaining - quantity);
    }

    const allocatedQuantity = this.round4(
      allocations.reduce((sum, item) => sum + item.quantity, 0),
    );

    return {
      allocations,
      requestedQuantity: this.round4(requestedQuantity),
      allocatedQuantity,
      remainingQuantity: this.round4(
        Math.max(0, requestedQuantity - allocatedQuantity),
      ),
    };
  }

  private round4(value: Decimal.Value) {
    return roundDecimal(value, 4);
  }

  private generateBatchNo() {
    return `BATCH${nextDocumentTimestamp()}`;
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
