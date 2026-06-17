import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KyselyService } from '../core/prisma/kysely.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { roundDecimal } from '../core/utils/decimal';

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
export class StockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kyselyService: KyselyService,
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

      const countResult = await trx
        .selectFrom(baseQuery.as('sub'))
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .executeTakeFirst();
      const total = Number(countResult?.total ?? 0);

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
}
