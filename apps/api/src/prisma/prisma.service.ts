import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../core/tenant/tenant-context';

type PrismaMiddleware = Parameters<PrismaClient['$use']>[0];
type PrismaMiddlewareParams = Parameters<PrismaMiddleware>[0];
type PrismaMiddlewareNext = Parameters<PrismaMiddleware>[1];

type MiddlewareArgs = {
  data?: unknown;
  where?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COMPANY_SCOPED_MODELS = new Set([
  'Order',
  'OrderItem',
  'Partner',
  'Warehouse',
  'StockLocation',
  'StockQuant',
  'Material',
  'ProductCategory',
  'Product',
  'Bom',
  'BomLine',
  'FileRecord',
  'InventoryTransaction',
  'WorkOrder',
  'Invoice',
  'Workflow',
  'WorkflowState',
  'WorkflowTransition',
  'CustomFieldDefinition',
  'Account',
  'Journal',
  'JournalEntry',
  'EventDlq',
  'AuditLog',
  'Department',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
  'StockPicking',
  'StockMove',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({});

    this.$use((params: PrismaMiddlewareParams, next: PrismaMiddlewareNext) => {
      const tenantBound = TenantContext.hasStore();
      const companyId = TenantContext.getCompanyId();
      const modelName = params.model;
      const needsTenantScope =
        typeof modelName === 'string'
          ? COMPANY_SCOPED_MODELS.has(modelName)
          : false;

      if (!tenantBound || !needsTenantScope) {
        return next(params);
      }

      if (!companyId) {
        throw new Error(
          '租户上下文缺失: 未携带 x-company-id，数据库访问已阻止',
        );
      }

      // 【🚨 严重安全修复 - 移除连接池毒化漏洞】
      // 先前的代码直接使用了 this.$executeRaw设置RLS上下文，
      // 由于 Prisma 默认的连接池机制，该连接会被污染并复用，导致跨租户越权漏洞。
      // 当前暂时依靠下面的 parameters 拦截级 where 子句进行隔离。

      const args = (params.args ?? {}) as MiddlewareArgs;

      if (params.action === 'create' || params.action === 'upsert') {
        const data = isRecord(args.data) ? args.data : {};
        args.data = { ...data, companyId };
      }

      if (params.action === 'createMany') {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        args.data = data.map((item) => ({
          ...(isRecord(item) ? item : {}),
          companyId,
        }));
      }

      if (
        params.action === 'findMany' ||
        params.action === 'findFirst' ||
        params.action === 'count' ||
        params.action === 'aggregate' ||
        params.action === 'groupBy' ||
        params.action === 'updateMany' ||
        params.action === 'deleteMany'
      ) {
        const where = isRecord(args.where) ? args.where : {};
        args.where = {
          AND: [where, { companyId }],
        };
      }

      params.args = args;

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
