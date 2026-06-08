import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWorkOrderDto,
  CreateWorkReportDto,
  GenerateWorkOrdersFromOrderDto,
} from './dto/production.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import { InventoryService } from '../inventory/inventory.service';

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
  shortageQty: number;
  coveragePct: number;
  status: 'AVAILABLE' | 'SHORTAGE';
  affectedWorkOrders: MaterialAvailabilitySource[];
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
  ) {}

  async createWorkOrder(
    companyId: string,
    dto: CreateWorkOrderDto,
  ): Promise<WorkOrderRecord> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
    });
    if (!order) throw new NotFoundException('找不到对应的销售订单');

    return this.prisma.workOrder.create({
      data: {
        workOrderNo: `WO-${Date.now()}`,
        orderId: dto.orderId,
        productId: dto.productId,
        plannedQty: dto.plannedQty,
        status: 'PENDING',
        companyId,
      },
    });
  }

  async generateWorkOrdersFromSalesOrder(
    companyId: string,
    orderId: string,
    dto: GenerateWorkOrdersFromOrderDto = {},
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

    return this.prisma.$transaction(async (tx) => {
      const created: WorkOrderRecord[] = [];
      const skipped: GenerateWorkOrdersResult['skipped'] = [];

      for (const [productId, plannedQty] of quantitiesByProduct.entries()) {
        if (skipExisting && existingProductIds.has(productId)) {
          skipped.push({ productId, reason: '该产品已有生产工单' });
          continue;
        }
        const workOrder = await tx.workOrder.create({
          data: {
            workOrderNo: this.generateWorkOrderNo(),
            orderId: order.id,
            productId,
            plannedQty,
            status: 'PENDING',
            companyId,
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
    });
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
          reports: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
            openQty: this.round2(openQty),
            requiredQty: this.round2(requirement.quantity.toNumber()),
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
          openQty: this.round2(openQty),
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

    const [materials, quants] = await Promise.all([
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
    ]);

    const materialMap = new Map(
      materials.map((material) => [material.id, material]),
    );
    const onHandByMaterial = new Map<string, number>();
    for (const quant of quants) {
      const current = onHandByMaterial.get(quant.materialId) ?? 0;
      onHandByMaterial.set(
        quant.materialId,
        this.round2(current + Number(quant.quantity ?? 0)),
      );
    }

    const rows = materialIds
      .map((materialId): MaterialAvailabilityRow => {
        const material = materialMap.get(materialId);
        const requiredQty = this.round2(
          requiredByMaterial.get(materialId)?.toNumber() ?? 0,
        );
        const onHandQty = this.round2(onHandByMaterial.get(materialId) ?? 0);
        const shortageQty = this.round2(Math.max(0, requiredQty - onHandQty));
        return {
          materialId,
          sku: material?.sku ?? materialId,
          name: material?.name ?? materialId,
          category: material?.category ?? '-',
          unit: material?.unit ?? '-',
          requiredQty,
          onHandQty,
          shortageQty,
          coveragePct:
            requiredQty > 0
              ? this.round2(Math.min(100, (onHandQty / requiredQty) * 100))
              : 100,
          status: shortageQty > 0 ? 'SHORTAGE' : 'AVAILABLE',
          affectedWorkOrders: sourcesByMaterial.get(materialId) ?? [],
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

  async submitWorkReport(
    companyId: string,
    workOrderId: string,
    workerId: string,
    dto: CreateWorkReportDto,
  ): Promise<WorkReportRecord> {
    const wo = await this.prisma.workOrder.findFirst({
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
    if (!wo) throw new NotFoundException('无效的生产工单');

    if (dto.goodQty > 0) {
      if (!dto.sourceLocationId) {
        throw new BadRequestException('提交良品报工时必须选择原料领用库位');
      }
      if (!dto.destLocationId) {
        throw new BadRequestException('提交良品报工时必须选择成品入库库位');
      }
      if (!wo.product.materialId) {
        throw new BadRequestException('产品未绑定成品物料，无法完工入库');
      }
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const report = await tx.workReport.create({
        data: {
          workOrderId,
          workerId,
          goodQty: dto.goodQty,
          defectQty: dto.defectQty,
        },
      });

      // Update actualQty and status in WorkOrder
      const newActual = wo.actualQty + dto.goodQty;
      let newStatus = wo.status;
      if (newStatus === 'PENDING') newStatus = 'IN_PROGRESS';
      if (newActual >= wo.plannedQty) newStatus = 'COMPLETED';

      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { actualQty: newActual, status: newStatus },
      });

      return report;
    });

    if (dto.goodQty > 0) {
      await this.postManufacturingInventory(companyId, wo, dto, workerId);
    }

    return report;
  }

  private async postManufacturingInventory(
    companyId: string,
    workOrder: {
      id: string;
      workOrderNo: string;
      productId: string;
      product: { materialId: string | null };
    },
    dto: CreateWorkReportDto,
    workerId: string,
  ) {
    const requirements = await this.resolveBomRequirements(
      companyId,
      workOrder.productId,
      new Decimal(dto.goodQty),
      new Set(),
    );

    for (const requirement of requirements) {
      const requiredQty = requirement.quantity.toNumber();

      await this.inventoryService.createStockMove(
        companyId,
        {
          materialId: requirement.materialId,
          sourceLocationId: dto.sourceLocationId,
          quantity: requiredQty,
          referenceNo: `PRODUCTION-ISSUE-${workOrder.workOrderNo}`,
          documentType: 'WORK_ORDER',
          documentId: workOrder.id,
          note: `生产领料：${workOrder.workOrderNo}`,
        },
        workerId,
      );
    }

    await this.inventoryService.createStockMove(
      companyId,
      {
        materialId: workOrder.product.materialId ?? '',
        destLocationId: dto.destLocationId,
        quantity: dto.goodQty,
        batchNo: dto.batchNo,
        referenceNo: `PRODUCTION-RECEIPT-${workOrder.workOrderNo}`,
        documentType: 'WORK_ORDER',
        documentId: workOrder.id,
        note: `完工入库：${workOrder.workOrderNo}`,
      },
      workerId,
    );
  }

  private async resolveBomRequirements(
    companyId: string,
    productId: string,
    quantity: Decimal,
    visitedProductIds: Set<string>,
  ): Promise<BomRequirement[]> {
    if (visitedProductIds.has(productId)) {
      throw new BadRequestException('检测到循环 BOM，无法展开生产领料');
    }
    visitedProductIds.add(productId);

    const bom = await this.prisma.bom.findFirst({
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

      const childProduct = await this.prisma.product.findFirst({
        where: {
          companyId,
          materialId: line.materialId,
        },
        select: { id: true },
      });

      if (childProduct) {
        const childBom = await this.prisma.bom.findFirst({
          where: {
            companyId,
            productId: childProduct.id,
            isDefault: true,
          },
          select: { id: true },
        });

        if (childBom) {
          const childRequirements = await this.resolveBomRequirements(
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

  private generateWorkOrderNo() {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}${String(now.getDate()).padStart(2, '0')}`;
    return `WO-${date}-${String(now.getTime()).slice(-6)}`;
  }

  private round2(value: number) {
    return Number(new Decimal(value).toDecimalPlaces(2).toString());
  }
}
