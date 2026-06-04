import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFinanceAccountMappingsDto } from './dto/finance-account-mapping.dto';

export const FINANCE_ACCOUNT_MAPPING_DEFINITIONS = [
  {
    key: 'RECEIVABLE',
    label: '应收账款',
    defaultAccount: { code: '1122', name: '应收账款', type: 'ASSET' },
  },
  {
    key: 'CUSTOMER_ADVANCE',
    label: '预收账款',
    defaultAccount: { code: '2203', name: '预收账款', type: 'LIABILITY' },
  },
  {
    key: 'CUSTOMER_REFUND_PAYABLE',
    label: '应退客户款',
    defaultAccount: {
      code: '224102',
      name: '应退客户款',
      type: 'LIABILITY',
    },
  },
  {
    key: 'PAYABLE',
    label: '应付账款',
    defaultAccount: { code: '2202', name: '应付账款', type: 'LIABILITY' },
  },
  {
    key: 'SUPPLIER_ADVANCE',
    label: '预付账款',
    defaultAccount: { code: '1123', name: '预付账款', type: 'ASSET' },
  },
  {
    key: 'BANK',
    label: '银行存款',
    defaultAccount: { code: '1002', name: '银行存款', type: 'ASSET' },
  },
  {
    key: 'CASH',
    label: '库存现金',
    defaultAccount: { code: '1001', name: '库存现金', type: 'ASSET' },
  },
  {
    key: 'ALIPAY',
    label: '支付宝',
    defaultAccount: { code: '101201', name: '支付宝', type: 'ASSET' },
  },
  {
    key: 'WECHAT',
    label: '微信支付',
    defaultAccount: { code: '101202', name: '微信支付', type: 'ASSET' },
  },
  {
    key: 'INVENTORY',
    label: '库存商品',
    defaultAccount: { code: '1405', name: '库存商品', type: 'ASSET' },
  },
  {
    key: 'PURCHASE_PRICE_VARIANCE',
    label: '采购价差',
    defaultAccount: {
      code: '500101',
      name: '采购价差',
      type: 'EXPENSE',
    },
  },
  {
    key: 'OUTPUT_TAX',
    label: '销项税',
    defaultAccount: {
      code: '222101',
      name: '应交税费-销项税',
      type: 'LIABILITY',
    },
  },
  {
    key: 'INPUT_TAX',
    label: '进项税',
    defaultAccount: {
      code: '222102',
      name: '应交税费-进项税',
      type: 'ASSET',
    },
  },
  {
    key: 'SALES_REVENUE',
    label: '销售收入',
    defaultAccount: { code: '6001', name: '主营业务收入', type: 'REVENUE' },
  },
  {
    key: 'COGS',
    label: '主营业务成本',
    defaultAccount: { code: '6401', name: '主营业务成本', type: 'EXPENSE' },
  },
] as const;

export type FinanceAccountMappingKey =
  (typeof FINANCE_ACCOUNT_MAPPING_DEFINITIONS)[number]['key'];

interface FallbackAccount {
  code: string;
  name: string;
  type: string;
}

@Injectable()
export class FinanceAccountMappingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    await this.ensureDefaultAccounts(companyId);
    const mappings = await this.prisma.financeAccountMapping.findMany({
      where: { companyId },
      include: { account: true },
    });
    const mappedByKey = new Map(mappings.map((item) => [item.key, item]));

    return FINANCE_ACCOUNT_MAPPING_DEFINITIONS.map((definition) => {
      const mapped = mappedByKey.get(definition.key);
      return {
        key: definition.key,
        label: definition.label,
        defaultAccount: definition.defaultAccount,
        account: mapped?.account ?? null,
      };
    });
  }

  async listAccountOptions(companyId: string) {
    await this.ensureDefaultAccounts(companyId);
    return this.prisma.account.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
    });
  }

  async update(companyId: string, dto: UpdateFinanceAccountMappingsDto) {
    const allowedKeys = new Set<string>(
      FINANCE_ACCOUNT_MAPPING_DEFINITIONS.map((definition) => definition.key),
    );
    const uniqueKeys = new Set<string>();

    for (const mapping of dto.mappings) {
      if (!allowedKeys.has(mapping.key)) {
        throw new BadRequestException(`不支持的科目映射: ${mapping.key}`);
      }
      if (uniqueKeys.has(mapping.key)) {
        throw new BadRequestException(`重复的科目映射: ${mapping.key}`);
      }
      uniqueKeys.add(mapping.key);
    }

    const accounts = await this.prisma.account.findMany({
      where: {
        companyId,
        id: { in: dto.mappings.map((mapping) => mapping.accountId) },
        isActive: true,
      },
    });
    const accountIds = new Set(accounts.map((account) => account.id));
    for (const mapping of dto.mappings) {
      if (!accountIds.has(mapping.accountId)) {
        throw new BadRequestException('映射科目不存在或已停用');
      }
    }

    await this.prisma.$transaction(
      dto.mappings.map((mapping) => {
        const definition = this.definitionFor(mapping.key);
        return this.prisma.financeAccountMapping.upsert({
          where: { companyId_key: { companyId, key: mapping.key } },
          update: {
            accountId: mapping.accountId,
            label: definition.label,
          },
          create: {
            companyId,
            key: mapping.key,
            label: definition.label,
            accountId: mapping.accountId,
          },
        });
      }),
    );

    return this.list(companyId);
  }

  async resolveLineAccount(
    companyId: string,
    key: FinanceAccountMappingKey,
    fallback?: FallbackAccount,
  ) {
    const definition = this.definitionFor(key);
    const mapping = await this.prisma.financeAccountMapping.findUnique({
      where: { companyId_key: { companyId, key } },
      include: { account: true },
    });

    if (mapping?.account?.isActive) {
      return {
        accountCode: mapping.account.code,
        accountName: mapping.account.name,
        accountType: mapping.account.type,
      };
    }

    const account = fallback
      ? await this.ensureAccount(companyId, fallback)
      : await this.ensureAccount(companyId, definition.defaultAccount);

    return {
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
    };
  }

  async ensureDefaultAccounts(companyId: string) {
    for (const definition of FINANCE_ACCOUNT_MAPPING_DEFINITIONS) {
      await this.ensureAccount(companyId, definition.defaultAccount);
    }
  }

  private definitionFor(key: string) {
    const definition = FINANCE_ACCOUNT_MAPPING_DEFINITIONS.find(
      (item) => item.key === key,
    );
    if (!definition) {
      throw new BadRequestException(`不支持的科目映射: ${key}`);
    }
    return definition;
  }

  private async ensureAccount(companyId: string, account: FallbackAccount) {
    return this.prisma.account.upsert({
      where: { companyId_code: { companyId, code: account.code } },
      update: {
        isActive: true,
      },
      create: {
        companyId,
        code: account.code,
        name: account.name,
        type: account.type,
        isActive: true,
      },
    });
  }
}
