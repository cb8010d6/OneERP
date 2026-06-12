import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getStats(companyId: string) {
    const cacheKey = `dashboard:stats:${companyId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const [
      totalOrders,
      activeOrders,
      stockAggregation,
      totalCustomers,
      pendingInvoices,
    ] = await Promise.all([
      this.prisma.order.count({ where: { companyId } }),
      this.prisma.order.count({
        where: { companyId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      }),
      this.prisma.$queryRaw<{ total_value: number; low_stock_count: number }[]>`
        SELECT
          COALESCE(SUM(CAST(sq.quantity AS NUMERIC) * CAST(m."unitPrice" AS NUMERIC)), 0) AS total_value,
          COUNT(*) FILTER (WHERE CAST(sq.quantity AS NUMERIC) < CAST(COALESCE(m."minStock", 10) AS NUMERIC)) AS low_stock_count
        FROM "StockQuant" sq
        JOIN "Material" m ON sq."materialId" = m.id
        JOIN "StockLocation" sl ON sq."locationId" = sl.id
        WHERE sl."companyId" = ${companyId}
      `,
      this.prisma.partner.count({
        where: { companyId, type: { in: ['CUSTOMER', 'BOTH'] } },
      }),
      this.prisma.invoice.count({
        where: { companyId, status: { in: ['UNPAID', 'PARTIAL'] } },
      }),
    ]);

    const result = {
      totalOrders,
      activeOrders,
      totalStockValue: Number(stockAggregation[0]?.total_value ?? 0),
      lowStockItems: Number(stockAggregation[0]?.low_stock_count ?? 0),
      totalCustomers,
      pendingInvoices,
    };

    await this.cacheManager.set(cacheKey, result, 60000);
    return result;
  }

  async getChartData(companyId: string) {
    const days = 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);

    const [orderRows, invoiceRows] = await Promise.all([
      this.prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM "Order"
        WHERE "companyId" = ${companyId} AND "createdAt" >= ${startDate} AND "createdAt" < ${endDate}
        GROUP BY "createdAt"::date
      `,
      this.prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT TO_CHAR("issuedDate"::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM "Invoice"
        WHERE "companyId" = ${companyId} AND "issuedDate" >= ${startDate} AND "issuedDate" < ${endDate}
        GROUP BY "issuedDate"::date
      `,
    ]);

    const orderMap = new Map(orderRows.map((r) => [r.date, r.count]));
    const invoiceMap = new Map(invoiceRows.map((r) => [r.date, r.count]));

    const result: { date: string; orders: number; invoices: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        orders: orderMap.get(dateStr) ?? 0,
        invoices: invoiceMap.get(dateStr) ?? 0,
      });
    }
    return result;
  }
}
