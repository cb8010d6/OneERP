import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { EventQueueService } from '../core/events/event-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractOrderBatchDto } from './dto/create-contract-order-batch.dto';

const ORDER_DOCUMENT_TYPE = 'SALES_ORDER';
const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class ContractOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async getPreview(companyId: string, contractId: string) {
    const contract = await this.readContract(
      this.prisma,
      companyId,
      contractId,
    );
    const allocated = await this.readAllocatedQuantities(
      this.prisma,
      companyId,
      contract.id,
    );
    return this.buildPreview(contract, allocated);
  }

  async createBatch(
    companyId: string,
    operatorId: string,
    contractId: string,
    data: CreateContractOrderBatchDto,
  ) {
    const normalized = this.normalizeRequest(data);
    const sourceBatchHash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.order.findFirst({
              where: { companyId, sourceBatchKey: normalized.sourceBatchKey },
              include: { items: true, partner: true },
            });
            if (existing) {
              if (
                existing.salesContractId !== contractId ||
                existing.sourceBatchHash !== sourceBatchHash
              ) {
                throw new ConflictException(
                  'sourceBatchKey 已用于不同的合同转单请求',
                );
              }
              return { order: existing, idempotentReplay: true };
            }

            const contract = await this.readContract(tx, companyId, contractId);
            const allocated = await this.readAllocatedQuantities(
              tx,
              companyId,
              contract.id,
            );
            const sourceItems = new Map(
              contract.quoteVersion.items.map((item) => [item.id, item]),
            );
            const seen = new Set<string>();
            let subTotal = new Prisma.Decimal(0);
            let taxTotal = new Prisma.Decimal(0);
            const orderItems = normalized.items.map((requested) => {
              if (seen.has(requested.quoteVersionItemId)) {
                throw new BadRequestException('同一报价明细不能重复提交');
              }
              seen.add(requested.quoteVersionItemId);
              const source = sourceItems.get(requested.quoteVersionItemId);
              if (!source) {
                throw new BadRequestException('转单明细不属于当前合同来源报价');
              }
              const contracted = new Prisma.Decimal(source.quantity);
              const used = allocated.get(source.id) ?? new Prisma.Decimal(0);
              const requestedQuantity = new Prisma.Decimal(requested.quantity);
              if (used.plus(requestedQuantity).greaterThan(contracted)) {
                throw new BadRequestException(
                  `报价明细 ${source.nameSnapshot} 的累计转单数量超过合同数量`,
                );
              }

              const netAmount = requestedQuantity
                .mul(source.unitPrice)
                .mul(new Prisma.Decimal(1).minus(source.discountRate))
                .toDecimalPlaces(4);
              const taxAmount = netAmount
                .mul(source.taxRate)
                .toDecimalPlaces(4);
              const grossAmount = netAmount.plus(taxAmount).toDecimalPlaces(4);
              subTotal = subTotal.plus(netAmount);
              taxTotal = taxTotal.plus(taxAmount);
              return {
                productId: source.productId,
                quantity: requested.quantity,
                unitPrice: source.unitPrice,
                subTotal: netAmount,
                taxAmount,
                totalPrice: grossAmount,
                taxRate: source.taxRate,
                sourceQuoteVersionItemId: source.id,
                customAttributes: {
                  source: 'sales-contract',
                  skuSnapshot: source.skuSnapshot,
                  nameSnapshot: source.nameSnapshot,
                  uomSnapshot: source.uomSnapshot,
                  discountRate: String(source.discountRate),
                },
              };
            });

            const now = new Date();
            const year = Number(
              new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
              }).format(now),
            );
            const sequence = await tx.documentSequence.upsert({
              where: {
                companyId_documentType_year: {
                  companyId,
                  documentType: ORDER_DOCUMENT_TYPE,
                  year,
                },
              },
              create: {
                companyId,
                documentType: ORDER_DOCUMENT_TYPE,
                year,
                lastValue: 1,
              },
              update: { lastValue: { increment: 1 } },
              select: { lastValue: true },
            });
            const companyCode = companyId
              .replace(/[^A-Za-z0-9]/g, '')
              .slice(0, 6)
              .toUpperCase();
            const orderNo = `ORD-${year}-${companyCode}-${String(sequence.lastValue).padStart(6, '0')}`;
            const created = await tx.order.create({
              data: {
                orderNo,
                companyId,
                partnerId: contract.partnerId,
                salesId: contract.ownerId,
                status: 'DRAFT',
                totalAmount: subTotal.plus(taxTotal).toDecimalPlaces(4),
                subTotal: subTotal.toDecimalPlaces(4),
                taxTotal: taxTotal.toDecimalPlaces(4),
                expectedDate: normalized.expectedDate,
                notes: normalized.notes,
                salesContractId: contract.id,
                contractVersionId: contract.versions[0].id,
                sourceBatchKey: normalized.sourceBatchKey,
                sourceBatchHash,
                aiSummary: {
                  source: 'sales-contract',
                  contractNo: contract.contractNo,
                  sourceBatchKey: normalized.sourceBatchKey,
                },
                items: { create: orderItems },
              },
              include: { items: true, partner: true },
            });
            await tx.auditLog.create({
              data: {
                userId: operatorId,
                companyId,
                entity: 'salesContract',
                entityId: contract.id,
                action: 'CONTRACT_ORDER_BATCH_CREATED',
                details: {
                  contractNo: contract.contractNo,
                  orderId: created.id,
                  orderNo: created.orderNo,
                  sourceBatchKey: normalized.sourceBatchKey,
                },
              },
            });
            return { order: created, idempotentReplay: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        await this.eventQueueService.publish({
          eventName: 'order.created',
          idempotencyKey: `order_created:${result.order.id}`,
          companyId,
          payload: {
            orderId: result.order.id,
            companyId,
            operatorId,
            status: result.order.status,
            items: result.order.items,
            partnerId: result.order.partnerId,
            contractId,
            sourceBatchKey: normalized.sourceBatchKey,
          },
          maxAttempts: 5,
        });
        return result;
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code);
        if (!retryable || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      }
    }
    throw new ConflictException('合同转单并发冲突，请重试');
  }

  private normalizeRequest(data: CreateContractOrderBatchDto) {
    return {
      sourceBatchKey: data.sourceBatchKey.trim(),
      items: [...data.items]
        .map((item) => ({
          quoteVersionItemId: item.quoteVersionItemId,
          quantity: item.quantity,
        }))
        .sort((left, right) =>
          left.quoteVersionItemId.localeCompare(right.quoteVersionItemId),
        ),
      expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
      notes: data.notes?.trim() || null,
    };
  }

  private async readContract(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    contractId: string,
  ) {
    const contract = await client.salesContract.findFirst({
      where: { id: contractId, companyId },
      select: {
        id: true,
        contractNo: true,
        status: true,
        partnerId: true,
        ownerId: true,
        currentVersionNo: true,
        versions: {
          take: 1,
          orderBy: { versionNo: 'desc' },
          select: { id: true, versionNo: true, status: true },
        },
        quoteVersion: {
          select: {
            id: true,
            items: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                productId: true,
                skuSnapshot: true,
                nameSnapshot: true,
                uomSnapshot: true,
                quantity: true,
                unitPrice: true,
                discountRate: true,
                taxRate: true,
              },
            },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('合同不存在或无权访问');
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException('只有生效合同可以转销售订单');
    }
    const version = contract.versions[0];
    if (
      !version ||
      version.versionNo !== contract.currentVersionNo ||
      version.status !== 'ACTIVE'
    ) {
      throw new ConflictException('合同当前版本状态不完整，请刷新后重试');
    }
    return contract;
  }

  private async readAllocatedQuantities(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    contractId: string,
  ) {
    const orders = await client.order.findMany({
      where: {
        companyId,
        salesContractId: contractId,
        status: { not: 'CANCELLED' },
      },
      select: {
        items: {
          select: { sourceQuoteVersionItemId: true, quantity: true },
        },
      },
    });
    const allocated = new Map<string, Prisma.Decimal>();
    for (const order of orders) {
      for (const item of order.items) {
        if (!item.sourceQuoteVersionItemId) continue;
        const current =
          allocated.get(item.sourceQuoteVersionItemId) ?? new Prisma.Decimal(0);
        allocated.set(
          item.sourceQuoteVersionItemId,
          current.plus(item.quantity),
        );
      }
    }
    return allocated;
  }

  private buildPreview(
    contract: Awaited<ReturnType<ContractOrderService['readContract']>>,
    allocated: Map<string, Prisma.Decimal>,
  ) {
    return {
      contractId: contract.id,
      contractNo: contract.contractNo,
      status: contract.status,
      items: contract.quoteVersion.items.map((item) => {
        const allocatedQuantity =
          allocated.get(item.id) ?? new Prisma.Decimal(0);
        return {
          quoteVersionItemId: item.id,
          productId: item.productId,
          sku: item.skuSnapshot,
          name: item.nameSnapshot,
          uom: item.uomSnapshot,
          unitPrice: String(item.unitPrice),
          contractedQuantity: String(item.quantity),
          allocatedQuantity: allocatedQuantity.toString(),
          remainingQuantity: new Prisma.Decimal(item.quantity)
            .minus(allocatedQuantity)
            .toString(),
        };
      }),
    };
  }
}
