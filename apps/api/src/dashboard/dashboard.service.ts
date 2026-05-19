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
      allStocks,
      totalCustomers,
      pendingInvoices,
    ] = await Promise.all([
      this.prisma.order.count({ where: { companyId } }),
      this.prisma.order.count({
        where: { companyId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      }),
      this.prisma.stockQuant.findMany({
        where: { location: { companyId } },
        include: { material: true },
      }),
      this.prisma.partner.count({
        where: { companyId, type: { in: ['CUSTOMER', 'BOTH'] } },
      }),
      this.prisma.invoice.count({
        where: { companyId, status: { in: ['UNPAID', 'PARTIAL'] } },
      }),
    ]);

    let totalStockValue = 0;
    let lowStockItems = 0;

    allStocks.forEach((stock) => {
      // 使用物料真实单价，未设置则为 0
      const unitPrice = Number(stock.material?.unitPrice ?? 0);
      const quantity = Number(stock.quantity ?? 0);
      totalStockValue += quantity * unitPrice;
      // 低库存预警：库存量低于物料设定的最低库存
      const minStock = Number(stock.material?.minStock ?? 10);
      if (quantity < minStock) {
        lowStockItems++;
      }
    });

    const result = {
      totalOrders,
      activeOrders,
      totalStockValue,
      lowStockItems,
      totalCustomers,
      pendingInvoices,
    };

    await this.cacheManager.set(cacheKey, result, 60000); // 缓存60秒
    return result;
  }

  async getChartData(companyId: string) {
    const days = 7;
    const result: { date: string; orders: number; invoices: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      const [orders, invoices] = await Promise.all([
        this.prisma.order.count({
          where: { companyId, createdAt: { gte: start, lte: end } },
        }),
        this.prisma.invoice.count({
          where: { companyId, issuedDate: { gte: start, lte: end } },
        }),
      ]);

      result.push({
        date: start.toISOString().split('T')[0],
        orders,
        invoices,
      });
    }
    return result;
  }
}
