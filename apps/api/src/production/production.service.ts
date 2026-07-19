import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { roundDecimal } from '../core/utils/decimal';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePurchaseOrderFromShortagesDto,
  CreateWorkOrderDto,
  CreateWorkReportDto,
  GenerateWorkOrdersFromOrderDto,
  ReverseWorkReportDto,
} from './dto/production.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import { nextDocumentTimestamp } from '../core/utils/document-timestamp';
import { withUniqueConstraintRetry } from '../core/utils/prisma-unique-retry';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseService } from '../purchase/purchase.service';

export interface WorkOrderRecord {
  id: string;
  workOrderNo: string;
  orderId: string;
  productId: string;
  plannedQty: number;
  status: string;
  companyId: string;
}

export interface WorkReportRecord {
  id: string;
  workOrderId: string;
  workerId: string;
  goodQty: number;
  defectQty: number;
  inventoryTransactionIds?: string[];
  idempotentReplay?: boolean;
}

interface BomRequirement {
  materialId: string;
  quantity: Decimal;
}

interface MaterialAvailabilitySource {
  workOrderId: string;
  workOrderNo: string;
  productId: string;
  productSku: string | null;
  productName: string;
  orderNo: string | null;
  customerName: string | null;
  openQty: number;
  requiredQty: number;
}

export interface MaterialAvailabilityRow {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  requiredQty: number;
  onHandQty: number;
  incomingQty: number;
  projectedQty: number;
  shortageQty: number;
  suggestedPurchaseQty: number;
  unitPrice: number;
  estimatedAmount: number;
  coveragePct: number;
  status: 'AVAILABLE' | 'SHORTAGE';
  affectedWorkOrders: MaterialAvailabilitySource[];
  incomingSources: MaterialAvailabilityIncomingSource[];
}

export interface MaterialAvailabilityIncomingSource {
  purchaseOrderId: string;
  purchaseNo: string;
  supplierName: string | null;
  status: string;
  expectedDate: string | null;
  orderedQty: number;
  receivedQty: number;
  incomingQty: number;
}

export interface MaterialAvailabilityMissingBom {
  workOrderId: string;
  workOrderNo: string;
  productId: string;
  productSku: string | null;
  productName: string;
  openQty: number;
  reason: string;
}

export interface MaterialAvailabilityResult {
  rows: MaterialAvailabilityRow[];
  shortageCount: number;
  totalOpenWorkOrders: number;
  missingBomWorkOrders: MaterialAvailabilityMissingBom[];
}

export interface GenerateWorkOrdersResult {
  orderId: string;
  orderNo: string;
  created: WorkOrderRecord[];
  skipped: Array<{
    productId: string;
    reason: string;
  }>;
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly purchaseService: PurchaseService,
  ) {}

  async createWorkOrder(
    companyId: string,
    dto: CreateWorkOrderDto,
    operatorId?: string,
  ): Promise<WorkOrderRecord> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('找不到对应的销售订单');
    if (!order.items.some((item) => item.productId === dto.productId)) {
      throw new BadRequestException('生产产品不属于当前销售订单');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, isActive: true },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('生产产品不存在或已停用');
    const revisionsByProduct = await this.validateReleasedRevisions(
      companyId,
      order.id,
      [dto.productId],
      dto.engineeringRevisionIds,
    );
    const pinnedById = operatorId ?? order.salesId;

    return withUniqueConstraintRetry(
      (attempt) =>
        this.prisma.$transaction(async (tx) => {
          const workOrder = await tx.workOrder.create({
            data: {
              workOrderNo: this.generateWorkOrderNo(attempt),
              orderId: dto.orderId,
              productId: dto.productId,
              plannedQty: dto.plannedQty,
              status: 'PENDING',
              companyId,
              engineeringRevisionPins: {
                create: (revisionsByProduct.get(dto.productId) ?? []).map(
                  (revision) => ({
                    engineeringRevisionId: revision.id,
                    companyId,
                    pinnedById,
                  }),
                ),
              },
            },
          });
          await tx.auditLog.create({
            data: {
              companyId,
              userId: pinnedById,
              entity: 'workOrder',
              entityId: workOrder.id,
              action: 'WORK_ORDER_ENGINEERING_REVISIONS_PINNED',
              details: {
                engineeringRevisionIds: dto.engineeringRevisionIds,
              } as Prisma.InputJsonValue,
            },
          });
          return workOrder;
        }),
      { targetFields: ['workOrderNo'] },
    );
  }

  async generateWorkOrdersFromSalesOrder(
    companyId: string,
    orderId: string,
    dto: GenerateWorkOrdersFromOrderDto,
    operatorId?: string,
  ): Promise<GenerateWorkOrdersResult> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      include: { items: true, workOrders: true },
    });
    if (!order) throw new NotFoundException('找不到对应的销售订单');
    if (['CANCELLED', 'COMPLETED'].includes(order.status)) {
      throw new BadRequestException('当前销售订单状态不允许生成生产工单');
    }
    if (order.items.length === 0) {
      throw new BadRequestException('销售订单没有明细，无法生成生产工单');
    }

    const productIds = [...new Set(order.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, isActive: true },
      select: { id: true, sku: true, name: true },
    });
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );
    const boms = await this.prisma.bom.findMany({
      where: { companyId, productId: { in: productIds }, isDefault: true },
      select: { productId: true },
    });
    const bomProductIds = new Set(boms.map((bom) => bom.productId));
    const missing: string[] = [];

    for (const productId of productIds) {
      const product = productMap.get(productId);
      if (!product) {
        missing.push(productId);
        continue;
      }
      if (!bomProductIds.has(productId)) {
        missing.push(`${product.sku || product.name} 未配置默认 BOM`);
      }
    }
    if (missing.length > 0) {
      throw new BadRequestException(`无法生成生产工单：${missing.join('；')}`);
    }
    const revisionsByProduct = await this.validateReleasedRevisions(
      companyId,
      order.id,
      productIds,
      dto.engineeringRevisionIds,
    );
    const pinnedById = operatorId ?? order.salesId;

    const quantitiesByProduct = new Map<string, number>();
    for (const item of order.items) {
      quantitiesByProduct.set(
        item.productId,
        (quantitiesByProduct.get(item.productId) ?? 0) + Number(item.quantity),
      );
    }

    const existingProductIds = new Set(
      order.workOrders.map((workOrder) => workOrder.productId),
    );
    const skipExisting = dto.skipExisting !== false;

    return withUniqueConstraintRetry(
      (attempt) =>
        this.prisma.$transaction(async (tx) => {
          const created: WorkOrderRecord[] = [];
          const skipped: GenerateWorkOrdersResult['skipped'] = [];
          const offsetBase = attempt * quantitiesByProduct.size;

          for (const [productId, plannedQty] of quantitiesByProduct.entries()) {
            if (skipExisting && existingProductIds.has(productId)) {
              skipped.push({ productId, reason: '该产品已有生产工单' });
              continue;
            }
            const workOrder = await tx.workOrder.create({
              data: {
                workOrderNo: this.generateWorkOrderNo(
                  offsetBase + created.length,
                ),
                orderId: order.id,
                productId,
                plannedQty,
                status: 'PENDING',
                companyId,
                engineeringRevisionPins: {
                  create: (revisionsByProduct.get(productId) ?? []).map(
                    (revision) => ({
                      engineeringRevisionId: revision.id,
                      companyId,
                      pinnedById,
                    }),
                  ),
                },
              },
            });
            await tx.auditLog.create({
              data: {
                companyId,
                userId: pinnedById,
                entity: 'workOrder',
                entityId: workOrder.id,
                action: 'WORK_ORDER_ENGINEERING_REVISIONS_PINNED',
                details: {
                  engineeringRevisionIds: (
                    revisionsByProduct.get(productId) ?? []
                  ).map((revision) => revision.id),
                } as Prisma.InputJsonValue,
              },
            });
            created.push(workOrder);
          }

          if (created.length > 0 && order.status !== 'IN_PRODUCTION') {
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'IN_PRODUCTION' },
            });
          }

          return {
            orderId: order.id,
            orderNo: order.orderNo,
            created,
            skipped,
          };
        }),
      { targetFields: ['workOrderNo'] },
    );
  }

  async getWorkOrders(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: {
          order: {
            select: { orderNo: true, partner: { select: { name: true } } },
          },
          reports: {
            orderBy: { reportDate: 'desc' },
            include: { reversal: true },
          },
          engineeringRevisionPins: {
            include: {
              engineeringRevision: {
                include: {
                  fileRecord: true,
                  engineeringDocument: {
                    select: { id: true, documentNo: true, title: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async validateReleasedRevisions(
    companyId: string,
    orderId: string,
    productIds: string[],
    revisionIds: string[],
  ) {
    const uniqueRevisionIds = [...new Set(revisionIds)];
    if (uniqueRevisionIds.length === 0) {
      throw new BadRequestException('创建工单前必须选择已发布工程版本');
    }
    const revisions = await this.prisma.engineeringDocumentRevision.findMany({
      where: {
        id: { in: uniqueRevisionIds },
        companyId,
        status: 'RELEASED',
      },
      select: {
        id: true,
        engineeringDocument: {
          select: {
            productId: true,
            orderId: true,
            currentReleasedRevisionId: true,
          },
        },
      },
    });
    if (revisions.length !== uniqueRevisionIds.length) {
      throw new BadRequestException(
        '所选工程版本不存在、未发布或不属于当前公司',
      );
    }
    const result = new Map<string, typeof revisions>();
    for (const productId of productIds) {
      const applicable = revisions.filter(
        (revision) =>
          revision.engineeringDocument.currentReleasedRevisionId ===
            revision.id &&
          (revision.engineeringDocument.productId === productId ||
            (!revision.engineeringDocument.productId &&
              revision.engineeringDocument.orderId === orderId)),
      );
      if (applicable.length === 0) {
        throw new BadRequestException(
          `产品 ${productId} 没有选择当前有效的已发布工程版本`,
        );
      }
      result.set(productId, applicable);
    }
    return result;
  }

  async getMaterialAvailability(
    companyId: string,
  ): Promise<MaterialAvailabilityResult> {
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        companyId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: {
        product: {
          select: { id: true, sku: true, name: true },
        },
        order: {
          select: {
            orderNo: true,
            partner: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const requiredByMaterial = new Map<string, Decimal>();
    const sourcesByMaterial = new Map<string, MaterialAvailabilitySource[]>();
    const missingBomWorkOrders: MaterialAvailabilityMissingBom[] = [];

    for (const workOrder of workOrders) {
      const openQty = Math.max(
        0,
        Number(workOrder.plannedQty ?? 0) - Number(workOrder.actualQty ?? 0),
      );
      if (openQty <= 0) continue;

      try {
        const requirements = await this.resolveBomRequirements(
          this.prisma,
          companyId,
          workOrder.productId,
          new Decimal(openQty),
          new Set(),
        );

        for (const requirement of requirements) {
          const current =
            requiredByMaterial.get(requirement.materialId) ?? new Decimal(0);
          requiredByMaterial.set(
            requirement.materialId,
            current.plus(requirement.quantity),
          );

          const sources = sourcesByMaterial.get(requirement.materialId) ?? [];
          sources.push({
            workOrderId: workOrder.id,
            workOrderNo: workOrder.workOrderNo,
            productId: workOrder.productId,
            productSku: workOrder.product?.sku ?? null,
            productName: workOrder.product?.name ?? workOrder.productId,
            orderNo: workOrder.order?.orderNo ?? null,
            customerName: workOrder.order?.partner?.name ?? null,
            openQty: roundDecimal(openQty),
            requiredQty: roundDecimal(requirement.quantity.toNumber()),
          });
          sourcesByMaterial.set(requirement.materialId, sources);
        }
      } catch (error) {
        if (!(error instanceof BadRequestException)) {
          throw error;
        }
        missingBomWorkOrders.push({
          workOrderId: workOrder.id,
          workOrderNo: workOrder.workOrderNo,
          productId: workOrder.productId,
          productSku: workOrder.product?.sku ?? null,
          productName: workOrder.product?.name ?? workOrder.productId,
          openQty: roundDecimal(openQty),
          reason:
            error instanceof Error && error.message
              ? error.message
              : '无法展开 BOM',
        });
      }
    }

    const materialIds = [...requiredByMaterial.keys()];
    if (materialIds.length === 0) {
      return {
        rows: [],
        shortageCount: 0,
        totalOpenWorkOrders: workOrders.length,
        missingBomWorkOrders,
      };
    }

    const [materials, quants, purchaseLines] = await Promise.all([
      this.prisma.material.findMany({
        where: {
          id: { in: materialIds },
          OR: [{ companyId }, { companyId: null }],
        },
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          unit: true,
          unitPrice: true,
        },
      }),
      this.prisma.stockQuant.findMany({
        where: {
          materialId: { in: materialIds },
          location: {
            companyId,
            usage: 'INTERNAL',
            isActive: true,
          },
        },
        select: {
          materialId: true,
          quantity: true,
        },
      }),
      this.prisma.purchaseOrderLine.findMany({
        where: {
          materialId: { in: materialIds },
          purchaseOrder: {
            companyId,
            status: { in: ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'] },
          },
        },
        select: {
          materialId: true,
          quantity: true,
          receivedQty: true,
          purchaseOrder: {
            select: {
              id: true,
              purchaseNo: true,
              status: true,
              expectedDate: true,
              supplier: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const materialMap = new Map(
      materials.map((material) => [material.id, material]),
    );
    const onHandByMaterial = new Map<string, number>();
    for (const quant of quants) {
      const current = onHandByMaterial.get(quant.materialId) ?? 0;
      onHandByMaterial.set(
        quant.materialId,
        roundDecimal(current + Number(quant.quantity ?? 0)),
      );
    }

    const incomingByMaterial = new Map<string, number>();
    const incomingSourcesByMaterial = new Map<
      string,
      MaterialAvailabilityIncomingSource[]
    >();
    for (const line of purchaseLines) {
      const outstanding = Math.max(
        0,
        Number(line.quantity ?? 0) - Number(line.receivedQty ?? 0),
      );
      if (outstanding <= 0) continue;
      const current = incomingByMaterial.get(line.materialId) ?? 0;
      incomingByMaterial.set(
        line.materialId,
        roundDecimal(current + outstanding),
      );
      const sources = incomingSourcesByMaterial.get(line.materialId) ?? [];
      sources.push({
        purchaseOrderId: line.purchaseOrder.id,
        purchaseNo: line.purchaseOrder.purchaseNo,
        supplierName: line.purchaseOrder.supplier?.name ?? null,
        status: line.purchaseOrder.status,
        expectedDate: line.purchaseOrder.expectedDate
          ? line.purchaseOrder.expectedDate.toISOString()
          : null,
        orderedQty: roundDecimal(Number(line.quantity ?? 0)),
        receivedQty: roundDecimal(Number(line.receivedQty ?? 0)),
        incomingQty: roundDecimal(outstanding),
      });
      incomingSourcesByMaterial.set(line.materialId, sources);
    }

    const rows = materialIds
      .map((materialId): MaterialAvailabilityRow => {
        const material = materialMap.get(materialId);
        const requiredQty = roundDecimal(
          requiredByMaterial.get(materialId)?.toNumber() ?? 0,
        );
        const onHandQty = roundDecimal(onHandByMaterial.get(materialId) ?? 0);
        const incomingQty = roundDecimal(
          incomingByMaterial.get(materialId) ?? 0,
        );
        const projectedQty = roundDecimal(onHandQty + incomingQty);
        const shortageQty = roundDecimal(
          Math.max(0, requiredQty - projectedQty),
        );
        const unitPrice = roundDecimal(Number(material?.unitPrice ?? 0));
        return {
          materialId,
          sku: material?.sku ?? materialId,
          name: material?.name ?? materialId,
          category: material?.category ?? '-',
          unit: material?.unit ?? '-',
          requiredQty,
          onHandQty,
          incomingQty,
          projectedQty,
          shortageQty,
          suggestedPurchaseQty: shortageQty,
          unitPrice,
          estimatedAmount: roundDecimal(shortageQty * unitPrice),
          coveragePct:
            requiredQty > 0
              ? roundDecimal(Math.min(100, (projectedQty / requiredQty) * 100))
              : 100,
          status: shortageQty > 0 ? 'SHORTAGE' : 'AVAILABLE',
          affectedWorkOrders: sourcesByMaterial.get(materialId) ?? [],
          incomingSources: incomingSourcesByMaterial.get(materialId) ?? [],
        };
      })
      .sort((left, right) => {
        if (right.shortageQty !== left.shortageQty) {
          return right.shortageQty - left.shortageQty;
        }
        return right.requiredQty - left.requiredQty;
      });

    return {
      rows,
      shortageCount: rows.filter((row) => row.shortageQty > 0).length,
      totalOpenWorkOrders: workOrders.length,
      missingBomWorkOrders,
    };
  }

  async createPurchaseOrderFromShortages(
    companyId: string,
    userId: string,
    dto: CreatePurchaseOrderFromShortagesDto,
  ) {
    const availability = await this.getMaterialAvailability(companyId);
    const selectedMaterialIds = new Set(
      (dto.materialIds ?? []).map((id) => id.trim()).filter(Boolean),
    );
    const shortageRows = availability.rows.filter((row) => {
      if (row.shortageQty <= 0) return false;
      return (
        selectedMaterialIds.size === 0 ||
        selectedMaterialIds.has(row.materialId)
      );
    });

    if (shortageRows.length === 0) {
      throw new BadRequestException('当前没有可生成采购单的生产物料短缺');
    }

    return this.purchaseService.createPurchaseOrder(companyId, userId, {
      supplierId: dto.supplierId,
      expectedDate: dto.expectedDate,
      notes:
        dto.notes ??
        `按生产物料短缺自动生成，涉及 ${shortageRows.length} 个物料`,
      items: shortageRows.map((row) => ({
        materialId: row.materialId,
        quantity: row.suggestedPurchaseQty,
        unitPrice: row.unitPrice,
        note: `生产缺料：需求 ${row.requiredQty}，现存 ${row.onHandQty}，在途 ${row.incomingQty}，缺口 ${row.shortageQty}`,
      })),
    });
  }

  async submitWorkReport(
    companyId: string,
    workOrderId: string,
    workerId: string,
    dto: CreateWorkReportDto,
  ): Promise<WorkReportRecord> {
    if (dto.goodQty === 0 && dto.defectQty === 0) {
      throw new BadRequestException('良品和不良品数量不能同时为 0');
    }
    const normalized = {
      workOrderId,
      goodQty: dto.goodQty,
      defectQty: dto.defectQty,
      sourceLocationId: dto.sourceLocationId?.trim() || null,
      destLocationId: dto.destLocationId?.trim() || null,
      batchNo: dto.batchNo?.trim() || null,
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.workReport.findUnique({
              where: {
                companyId_idempotencyKey: {
                  companyId,
                  idempotencyKey: dto.idempotencyKey,
                },
              },
            });
            if (existing) {
              if (
                existing.workOrderId !== workOrderId ||
                existing.payloadHash !== payloadHash
              ) {
                throw new ConflictException('报工幂等键已用于不同的提交内容');
              }
              return {
                report: existing,
                eventIds: [] as string[],
                idempotentReplay: true,
              };
            }

            const workOrder = await tx.workOrder.findFirst({
              where: { id: workOrderId, companyId },
              include: {
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    materialId: true,
                  },
                },
              },
            });
            if (!workOrder) throw new NotFoundException('无效的生产工单');
            if (workOrder.status === 'COMPLETED') {
              throw new ConflictException('生产工单已完工，不能继续报工');
            }
            if (workOrder.actualQty + dto.goodQty > workOrder.plannedQty) {
              throw new BadRequestException(
                `良品报工超过剩余数量 ${workOrder.plannedQty - workOrder.actualQty}`,
              );
            }
            if (dto.goodQty > 0) {
              if (!normalized.sourceLocationId) {
                throw new BadRequestException(
                  '提交良品报工时必须选择原料领用库位',
                );
              }
              if (!normalized.destLocationId) {
                throw new BadRequestException(
                  '提交良品报工时必须选择成品入库库位',
                );
              }
              if (!workOrder.product.materialId) {
                throw new BadRequestException(
                  '产品未绑定成品物料，无法完工入库',
                );
              }
            }

            const inventoryResult =
              dto.goodQty > 0
                ? await this.postManufacturingInventoryInTransaction(
                    tx,
                    companyId,
                    workOrder,
                    dto,
                    workerId,
                  )
                : { transactionIds: [], eventIds: [] };
            const newActual = workOrder.actualQty + dto.goodQty;
            const newStatus =
              newActual >= workOrder.plannedQty
                ? 'COMPLETED'
                : workOrder.status === 'PENDING'
                  ? 'IN_PROGRESS'
                  : workOrder.status;
            const report = await tx.workReport.create({
              data: {
                workOrderId,
                workerId,
                companyId,
                idempotencyKey: dto.idempotencyKey,
                payloadHash,
                goodQty: dto.goodQty,
                defectQty: dto.defectQty,
                inventoryTransactionIds:
                  inventoryResult.transactionIds as Prisma.InputJsonValue,
              },
            });
            await tx.workOrder.update({
              where: { id: workOrderId },
              data: { actualQty: newActual, status: newStatus },
            });
            await tx.auditLog.create({
              data: {
                companyId,
                userId: workerId,
                entity: 'workOrder',
                entityId: workOrderId,
                action: 'WORK_REPORT_POSTED',
                details: {
                  workReportId: report.id,
                  idempotencyKey: dto.idempotencyKey,
                  goodQty: dto.goodQty,
                  defectQty: dto.defectQty,
                  inventoryTransactionIds: inventoryResult.transactionIds,
                },
              },
            });
            return {
              report,
              eventIds: inventoryResult.eventIds,
              idempotentReplay: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        await this.inventoryService.dispatchQueuedEvents(result.eventIds);
        return {
          ...result.report,
          inventoryTransactionIds: Array.isArray(
            result.report.inventoryTransactionIds,
          )
            ? (result.report.inventoryTransactionIds as string[])
            : [],
          idempotentReplay: result.idempotentReplay,
        };
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code);
        if (!retryable || attempt === 3) throw error;
      }
    }
    throw new ConflictException('并发报工冲突，请重试');
  }

  async reverseWorkReport(
    companyId: string,
    workReportId: string,
    operatorId: string,
    dto: ReverseWorkReportDto,
  ) {
    const normalized = {
      workReportId,
      reason: dto.reason.trim(),
    };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.workReportReversal.findUnique({
              where: {
                companyId_idempotencyKey: {
                  companyId,
                  idempotencyKey: dto.idempotencyKey,
                },
              },
            });
            if (existing) {
              if (
                existing.workReportId !== workReportId ||
                existing.payloadHash !== payloadHash
              ) {
                throw new ConflictException('冲销幂等键已用于不同的请求内容');
              }
              return {
                reversal: existing,
                eventIds: [] as string[],
                idempotentReplay: true,
              };
            }

            const report = await tx.workReport.findFirst({
              where: { id: workReportId, companyId },
              include: { reversal: true, workOrder: true },
            });
            if (!report)
              throw new NotFoundException('报工记录不存在或无权访问');
            if (report.reversal) {
              throw new ConflictException('该报工记录已经冲销');
            }
            const originalIds = Array.isArray(report.inventoryTransactionIds)
              ? (report.inventoryTransactionIds as string[])
              : [];
            if (report.goodQty > 0 && originalIds.length === 0) {
              throw new ConflictException(
                '历史报工缺少库存流水快照，不能自动冲销',
              );
            }
            const originalTransactions = await tx.inventoryTransaction.findMany(
              {
                where: { id: { in: originalIds }, companyId },
              },
            );
            if (originalTransactions.length !== originalIds.length) {
              throw new ConflictException('原报工库存流水不完整，不能冲销');
            }
            const byId = new Map(
              originalTransactions.map((transaction) => [
                transaction.id,
                transaction,
              ]),
            );
            const reversedTransactionIds: string[] = [];
            const eventIds: string[] = [];
            for (const originalId of [...originalIds].reverse()) {
              const original = byId.get(originalId);
              if (!original) throw new ConflictException('原库存流水不存在');
              const reversalData =
                original.type === 'OUTBOUND'
                  ? {
                      materialId: original.materialId,
                      destLocationId: original.sourceLocationId ?? undefined,
                      quantity: Number(original.quantity),
                      batchNo: original.batchNo ?? undefined,
                    }
                  : original.type === 'INBOUND'
                    ? {
                        materialId: original.materialId,
                        sourceLocationId: original.destLocationId ?? undefined,
                        quantity: Number(original.quantity),
                        batchNo: original.batchNo ?? undefined,
                      }
                    : null;
              if (!reversalData) {
                throw new ConflictException('报工包含不支持自动冲销的调拨流水');
              }
              const transaction =
                await this.inventoryService.createStockMoveInTransaction(
                  tx,
                  companyId,
                  {
                    ...reversalData,
                    referenceNo: `PRODUCTION-REPORT-REV-${report.id}-${dto.idempotencyKey}`,
                    documentType: 'WORK_REPORT_REVERSAL',
                    documentId: report.id,
                    note: `报工冲销：${report.id} · ${normalized.reason}`,
                  },
                  operatorId,
                );
              reversedTransactionIds.push(transaction.id);
              const event =
                await this.inventoryService.queueStockDepletedInTransaction(
                  tx,
                  companyId,
                  transaction,
                  operatorId,
                );
              if (event) eventIds.push(event.id);
            }

            const newActual = Math.max(
              0,
              report.workOrder.actualQty - report.goodQty,
            );
            const otherActiveReports = await tx.workReport.count({
              where: {
                workOrderId: report.workOrderId,
                id: { not: report.id },
                reversal: null,
              },
            });
            const newStatus =
              newActual === 0 && otherActiveReports === 0
                ? 'PENDING'
                : 'IN_PROGRESS';
            const reversal = await tx.workReportReversal.create({
              data: {
                workReportId: report.id,
                companyId,
                idempotencyKey: dto.idempotencyKey,
                payloadHash,
                reason: normalized.reason,
                reversedById: operatorId,
                inventoryTransactionIds:
                  reversedTransactionIds as Prisma.InputJsonValue,
              },
            });
            await tx.workOrder.update({
              where: { id: report.workOrderId },
              data: { actualQty: newActual, status: newStatus },
            });
            await tx.auditLog.create({
              data: {
                companyId,
                userId: operatorId,
                entity: 'workReport',
                entityId: report.id,
                action: 'WORK_REPORT_REVERSED',
                details: {
                  reversalId: reversal.id,
                  idempotencyKey: dto.idempotencyKey,
                  reason: normalized.reason,
                  originalInventoryTransactionIds: originalIds,
                  reversalInventoryTransactionIds: reversedTransactionIds,
                },
              },
            });
            return { reversal, eventIds, idempotentReplay: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        await this.inventoryService.dispatchQueuedEvents(result.eventIds);
        return {
          ...result.reversal,
          inventoryTransactionIds: Array.isArray(
            result.reversal.inventoryTransactionIds,
          )
            ? (result.reversal.inventoryTransactionIds as string[])
            : [],
          idempotentReplay: result.idempotentReplay,
        };
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code);
        if (!retryable || attempt === 3) throw error;
      }
    }
    throw new ConflictException('并发冲销冲突，请重试');
  }

  private async postManufacturingInventoryInTransaction(
    tx: Prisma.TransactionClient,
    companyId: string,
    workOrder: {
      id: string;
      workOrderNo: string;
      productId: string;
      product: { materialId: string | null };
    },
    dto: CreateWorkReportDto,
    workerId: string,
  ): Promise<{ transactionIds: string[]; eventIds: string[] }> {
    const requirements = await this.resolveBomRequirements(
      tx,
      companyId,
      workOrder.productId,
      new Decimal(dto.goodQty),
      new Set(),
    );

    const transactionIds: string[] = [];
    const eventIds: string[] = [];

    for (const requirement of requirements) {
      const requiredQty = requirement.quantity.toNumber();

      const transaction =
        await this.inventoryService.createStockMoveInTransaction(
          tx,
          companyId,
          {
            materialId: requirement.materialId,
            sourceLocationId: dto.sourceLocationId,
            quantity: requiredQty,
            referenceNo: `PRODUCTION-ISSUE-${workOrder.workOrderNo}-${dto.idempotencyKey}`,
            documentType: 'WORK_ORDER',
            documentId: workOrder.id,
            note: `生产领料：${workOrder.workOrderNo}`,
          },
          workerId,
        );
      transactionIds.push(transaction.id);
      const event = await this.inventoryService.queueStockDepletedInTransaction(
        tx,
        companyId,
        transaction,
        workerId,
      );
      if (event) eventIds.push(event.id);
    }

    const receipt = await this.inventoryService.createStockMoveInTransaction(
      tx,
      companyId,
      {
        materialId: workOrder.product.materialId ?? '',
        destLocationId: dto.destLocationId,
        quantity: dto.goodQty,
        batchNo: dto.batchNo,
        referenceNo: `PRODUCTION-RECEIPT-${workOrder.workOrderNo}-${dto.idempotencyKey}`,
        documentType: 'WORK_ORDER',
        documentId: workOrder.id,
        note: `完工入库：${workOrder.workOrderNo}`,
      },
      workerId,
    );
    transactionIds.push(receipt.id);
    return { transactionIds, eventIds };
  }

  private async resolveBomRequirements(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    productId: string,
    quantity: Decimal,
    visitedProductIds: Set<string>,
  ): Promise<BomRequirement[]> {
    if (visitedProductIds.has(productId)) {
      throw new BadRequestException('检测到循环 BOM，无法展开生产领料');
    }
    visitedProductIds.add(productId);

    const bom = await client.bom.findFirst({
      where: {
        companyId,
        productId,
        isDefault: true,
      },
      include: { lines: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!bom || bom.lines.length === 0) {
      throw new BadRequestException('产品未配置默认 BOM，无法按报工扣减原料');
    }

    const merged = new Map<string, Decimal>();

    for (const line of bom.lines) {
      const lineQuantity = quantity
        .times(line.quantity)
        .times(new Decimal(1).plus(line.scrapRate));

      const childProduct = await client.product.findFirst({
        where: {
          companyId,
          materialId: line.materialId,
        },
        select: { id: true },
      });

      if (childProduct) {
        const childBom = await client.bom.findFirst({
          where: {
            companyId,
            productId: childProduct.id,
            isDefault: true,
          },
          select: { id: true },
        });

        if (childBom) {
          const childRequirements = await this.resolveBomRequirements(
            client,
            companyId,
            childProduct.id,
            lineQuantity,
            new Set(visitedProductIds),
          );
          for (const requirement of childRequirements) {
            merged.set(
              requirement.materialId,
              (merged.get(requirement.materialId) ?? new Decimal(0)).plus(
                requirement.quantity,
              ),
            );
          }
          continue;
        }
      }

      merged.set(
        line.materialId,
        (merged.get(line.materialId) ?? new Decimal(0)).plus(lineQuantity),
      );
    }

    return [...merged.entries()].map(([materialId, requiredQty]) => ({
      materialId,
      quantity: requiredQty,
    }));
  }

  private generateWorkOrderNo(attempt = 0) {
    const timestamp = nextDocumentTimestamp(attempt);
    const now = new Date(timestamp);
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}${String(now.getDate()).padStart(2, '0')}`;
    return `WO-${date}-${String(timestamp).slice(-6)}`;
  }
}
