import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../core/tenant/tenant-context';

type PrismaMiddleware = Parameters<PrismaClient['$use']>[0];
type PrismaMiddlewareParams = Parameters<PrismaMiddleware>[0];
type PrismaMiddlewareNext = Parameters<PrismaMiddleware>[1];

type MiddlewareArgs = {
  create?: unknown;
  data?: unknown;
  update?: unknown;
  where?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COMPANY_SCOPED_MODELS = new Set([
  'Order',
  'Partner',
  'TaxCode',
  'Warehouse',
  'StockLocation',
  'Material',
  'ProductCategory',
  'Product',
  'Bom',
  'FileRecord',
  'InventoryTransaction',
  'WorkOrder',
  'Invoice',
  'Workflow',
  'CustomFieldDefinition',
  'Account',
  'Journal',
  'JournalEntry',
  'EventDlq',
  'AuditLog',
  'Department',
  'DocumentSequence',
  'CustomerRequirement',
  'RequirementActivity',
  'Quote',
  'QuoteVersion',
  'QuoteVersionItem',
  'SalesContract',
  'SalesContractVersion',
  'SalesContractApproval',
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

      const args = (params.args ?? {}) as MiddlewareArgs;
      const explicitCreateCompanyId =
        params.action === 'create' && isRecord(args.data)
          ? args.data.companyId
          : params.action === 'upsert' && isRecord(args.create)
            ? args.create.companyId
            : undefined;
      const resolvedCompanyId =
        companyId ||
        (typeof explicitCreateCompanyId === 'string'
          ? explicitCreateCompanyId
          : undefined);

      if (!resolvedCompanyId) {
        throw new Error(
          '租户上下文缺失: 未携带 x-company-id，数据库访问已阻止',
        );
      }

      // 【🚨 严重安全修复 - 移除连接池毒化漏洞】
      // 先前的代码直接使用了 this.$executeRaw设置RLS上下文，
      // 由于 Prisma 默认的连接池机制，该连接会被污染并复用，导致跨租户越权漏洞。
      // 当前暂时依靠下面的 parameters 拦截级 where 子句进行隔离。

      if (params.action === 'create') {
        const data = isRecord(args.data) ? args.data : {};
        args.data = { ...data, companyId: resolvedCompanyId };
      }

      if (params.action === 'upsert') {
        const create = isRecord(args.create) ? args.create : {};
        args.create = { ...create, companyId: resolvedCompanyId };
      }

      if (params.action === 'createMany') {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        args.data = data.map((item) => ({
          ...(isRecord(item) ? item : {}),
          companyId: resolvedCompanyId,
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
          AND: [where, { companyId: resolvedCompanyId }],
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
