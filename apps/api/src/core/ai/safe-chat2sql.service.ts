import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 安全 Chat2SQL 服务
 *
 * 不使用 $queryRawUnsafe，而是将自然语言问题映射到预定义的安全 Prisma 查询。
 * 所有查询强制注入 companyId 过滤，避免 SQL 注入和跨租户越权。
 */

interface StructuredQuery {
  model: string;
  aggregation?: 'count' | 'sum' | 'avg';
  aggregateField?: string;
  groupBy?: string;
  filters?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  take?: number;
  select?: string[];
}

export interface QueryResultRow {
  [key: string]: unknown;
}

// 白名单：允许查询的模型及其安全字段
const ALLOWED_MODELS: Record<
  string,
  {
    table: string;
    groupableFields: string[];
    aggregatableFields: string[];
    filterableFields: string[];
  }
> = {
  order: {
    table: 'order',
    groupableFields: ['status', 'createdAt'],
    aggregatableFields: ['totalAmount', 'subTotal', 'taxTotal'],
    filterableFields: ['status', 'createdAt', 'partnerId'],
  },
  invoice: {
    table: 'invoice',
    groupableFields: ['status', 'postingStatus', 'issuedDate'],
    aggregatableFields: ['amount', 'subTotal', 'taxAmount'],
    filterableFields: ['status', 'postingStatus', 'issuedDate'],
  },
  partner: {
    table: 'partner',
    groupableFields: ['type'],
    aggregatableFields: [],
    filterableFields: ['type', 'isActive'],
  },
  material: {
    table: 'material',
    groupableFields: ['category'],
    aggregatableFields: ['unitPrice', 'minStock'],
    filterableFields: ['category'],
  },
  inventoryTransaction: {
    table: 'inventoryTransaction',
    groupableFields: ['type', 'createdAt'],
    aggregatableFields: ['quantity'],
    filterableFields: ['type', 'createdAt', 'materialId'],
  },
  purchaseOrder: {
    table: 'purchaseOrder',
    groupableFields: ['status', 'orderDate'],
    aggregatableFields: ['totalAmount', 'subTotal', 'taxTotal'],
    filterableFields: ['status', 'orderDate', 'partnerId'],
  },
  goodsReceipt: {
    table: 'goodsReceipt',
    groupableFields: ['status', 'receiptDate'],
    aggregatableFields: [],
    filterableFields: ['status', 'receiptDate', 'partnerId'],
  },
};

@Injectable()
export class SafeChat2SqlService {
  private readonly logger = new Logger(SafeChat2SqlService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将自然语言问题映射到安全的结构化查询并执行。
   */
  async execute(
    question: string,
    companyId: string,
  ): Promise<{
    type: string;
    title: string;
    rows: QueryResultRow[];
    rowCount: number;
    queryDescription: string;
    chartSuggestion: { chartType: string; xKey?: string; yKey?: string };
  }> {
    const structured = this.parseQuestion(question);
    this.validateQuery(structured);

    const rows = await this.executeStructuredQuery(structured, companyId);
    const chartSuggestion = this.suggestChart(rows);

    return {
      type: 'table',
      title: `查询结果：${structured.model}`,
      rows,
      rowCount: rows.length,
      queryDescription: this.describeQuery(structured),
      chartSuggestion,
    };
  }

  /**
   * 将自然语言解析为结构化查询。
   * 使用关键词匹配而非 LLM，避免生成不安全 SQL。
   */
  private parseQuestion(question: string): StructuredQuery {
    const q = question.toLowerCase();

    // 识别模型
    const model = this.detectModel(q);

    // 识别聚合类型
    const aggregation = this.detectAggregation(q);

    // 识别分组
    const groupBy = this.detectGroupBy(q, model);

    // 识别时间过滤
    const filters = this.detectTimeFilter(q);

    // 识别排序和限制
    const take = this.detectLimit(q);

    return {
      model,
      aggregation: aggregation ?? undefined,
      aggregateField: aggregation
        ? this.detectAggregateField(q, model)
        : undefined,
      groupBy: groupBy ?? undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      orderBy: { createdAt: 'desc' },
      take: take ?? 20,
    };
  }

  private detectModel(q: string): string {
    if (q.includes('采购订单') || q.includes('purchase'))
      return 'purchaseOrder';
    if (q.includes('入库') || q.includes('收货')) return 'goodsReceipt';
    if (q.includes('发票') || q.includes('invoice')) return 'invoice';
    if (q.includes('库存') || q.includes('transaction'))
      return 'inventoryTransaction';
    if (
      q.includes('客户') ||
      q.includes('供应商') ||
      q.includes('伙伴') ||
      q.includes('partner')
    )
      return 'partner';
    if (q.includes('物料') || q.includes('material')) return 'material';
    return 'order';
  }

  private detectAggregation(q: string): 'count' | 'sum' | 'avg' | null {
    if (
      q.includes('多少') ||
      q.includes('数量') ||
      q.includes('count') ||
      q.includes('几个')
    )
      return 'count';
    if (
      q.includes('总') ||
      q.includes('合计') ||
      q.includes('sum') ||
      q.includes('金额')
    )
      return 'sum';
    if (q.includes('平均') || q.includes('avg')) return 'avg';
    return null;
  }

  private detectGroupBy(q: string, model: string): string | null {
    const config = ALLOWED_MODELS[model];
    if (!config) return null;

    for (const field of config.groupableFields) {
      // 中文关键词映射
      const keywords = this.getFieldKeywords(field);
      if (keywords.some((kw) => q.includes(kw))) {
        return field;
      }
    }

    // 如果有聚合但没有明确分组，按 status 分组
    if (
      (q.includes('多少') || q.includes('总') || q.includes('合计')) &&
      config.groupableFields.includes('status')
    ) {
      return 'status';
    }

    return null;
  }

  private getFieldKeywords(field: string): string[] {
    const map: Record<string, string[]> = {
      status: ['状态', 'status'],
      type: ['类型', 'type'],
      category: ['分类', 'category'],
      createdAt: ['时间', '日期', '日', '月', '年'],
      issuedDate: ['开票日期', '开票时间'],
      orderDate: ['下单日期', '下单时间'],
      receiptDate: ['收货日期', '收货时间'],
      postingStatus: ['过账状态'],
    };
    return map[field] ?? [field];
  }

  private detectAggregateField(q: string, model: string): string | undefined {
    const config = ALLOWED_MODELS[model];
    if (!config?.aggregatableFields.length) return undefined;

    for (const field of config.aggregatableFields) {
      const keywords = this.getFieldKeywords(field);
      if (keywords.some((kw) => q.includes(kw))) {
        return field;
      }
    }

    // 默认使用第一个可聚合字段
    return config.aggregatableFields[0];
  }

  private detectTimeFilter(q: string): Record<string, unknown> {
    const now = new Date();

    if (q.includes('今天') || q.includes('today')) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { createdAt: { gte: start } };
    }

    if (q.includes('本周') || q.includes('这周')) {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return { createdAt: { gte: start } };
    }

    if (q.includes('本月') || q.includes('这个月')) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { createdAt: { gte: start } };
    }

    if (q.includes('30天') || q.includes('一个月')) {
      const start = new Date(now);
      start.setDate(now.getDate() - 30);
      return { createdAt: { gte: start } };
    }

    if (q.includes('90天') || q.includes('三个月') || q.includes('一季度')) {
      const start = new Date(now);
      start.setDate(now.getDate() - 90);
      return { createdAt: { gte: start } };
    }

    // 默认最近 7 天
    if (q.includes('最近') || q.includes('recent')) {
      const days = this.extractDays(q) ?? 7;
      const start = new Date(now);
      start.setDate(now.getDate() - days);
      return { createdAt: { gte: start } };
    }

    return {};
  }

  private extractDays(q: string): number | null {
    const match = q.match(/(\d+)\s*[天日]/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0 && n <= 365) return n;
    }
    return null;
  }

  private detectLimit(q: string): number | null {
    const match = q.match(/(?:前|top|最多)\s*(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0 && n <= 100) return n;
    }
    return null;
  }

  private validateQuery(query: StructuredQuery): void {
    const config = ALLOWED_MODELS[query.model];
    if (!config) {
      throw new BadRequestException(`不支持查询模型: ${query.model}`);
    }

    if (query.groupBy && !config.groupableFields.includes(query.groupBy)) {
      throw new BadRequestException(`不允许按字段 ${query.groupBy} 分组`);
    }

    if (
      query.aggregateField &&
      !config.aggregatableFields.includes(query.aggregateField)
    ) {
      throw new BadRequestException(`不允许聚合字段 ${query.aggregateField}`);
    }
  }

  /**
   * 通过 Prisma ORM 执行结构化查询，完全避免 SQL 注入。
   */
  private async executeStructuredQuery(
    query: StructuredQuery,
    companyId: string,
  ): Promise<QueryResultRow[]> {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[
      query.model
    ] as {
      findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
      groupBy?: (args: Record<string, unknown>) => Promise<unknown[]>;
      count?: (args: Record<string, unknown>) => Promise<number>;
    };

    if (!delegate) {
      throw new BadRequestException(`Prisma 模型 ${query.model} 不可用`);
    }

    const baseWhere: Record<string, unknown> = {
      ...query.filters,
      companyId,
    };

    // 聚合 + 分组查询
    if (query.aggregation && query.groupBy) {
      if (!delegate.groupBy) {
        throw new BadRequestException(`模型 ${query.model} 不支持 groupBy`);
      }

      const groupByArgs: Record<string, unknown> = {
        by: [query.groupBy],
        where: baseWhere,
        orderBy: { [query.groupBy]: 'asc' as const },
      };

      if (query.aggregation === 'count') {
        groupByArgs._count = { _all: true };
      } else if (query.aggregateField) {
        groupByArgs[`_${query.aggregation}`] = {
          [query.aggregateField]: true,
        };
      }

      const grouped = (await delegate.groupBy(groupByArgs)) as Array<
        Record<string, unknown>
      >;

      return grouped.map((row) => {
        const result: QueryResultRow = {
          [query.groupBy!]: row[query.groupBy!],
        };

        if (query.aggregation === 'count') {
          result.count = (row._count as Record<string, unknown>)?._all ?? 0;
        } else if (query.aggregateField) {
          const aggKey = `_${query.aggregation}`;
          result[`${query.aggregation}_${query.aggregateField}`] =
            (row[aggKey] as Record<string, unknown>)?.[query.aggregateField] ??
            0;
        }

        return result;
      });
    }

    // 简单计数
    if (query.aggregation === 'count' && !query.groupBy) {
      if (!delegate.count) return [];
      const total = await delegate.count({ where: baseWhere });
      return [{ count: total }];
    }

    // 普通列表查询
    if (!delegate.findMany) return [];

    const findManyArgs: Record<string, unknown> = {
      where: baseWhere,
      take: query.take ?? 20,
    };

    if (query.orderBy) {
      findManyArgs.orderBy = query.orderBy;
    }

    if (query.select?.length) {
      findManyArgs.select = query.select.reduce<Record<string, boolean>>(
        (acc, field) => {
          acc[field] = true;
          return acc;
        },
        {},
      );
    }

    const rows = await delegate.findMany(findManyArgs);
    return rows as QueryResultRow[];
  }

  private describeQuery(query: StructuredQuery): string {
    const parts: string[] = [`查询 ${query.model}`];

    if (query.aggregation) {
      const aggLabel =
        query.aggregation === 'count'
          ? '计数'
          : query.aggregation === 'sum'
            ? '求和'
            : '平均值';
      parts.push(`聚合: ${aggLabel}`);
      if (query.aggregateField) {
        parts.push(`字段: ${query.aggregateField}`);
      }
    }

    if (query.groupBy) {
      parts.push(`分组: ${query.groupBy}`);
    }

    if (query.filters) {
      parts.push(`过滤: ${JSON.stringify(query.filters)}`);
    }

    parts.push(`限制: ${query.take ?? 20} 条`);

    return parts.join(' | ');
  }

  private suggestChart(rows: QueryResultRow[]): {
    chartType: string;
    xKey?: string;
    yKey?: string;
  } {
    if (!rows.length) {
      return { chartType: 'table' };
    }

    const first = rows[0];
    const keys = Object.keys(first);
    const numericKey = keys.find((key) => typeof first[key] === 'number');
    const categoryKey = keys.find((key) => typeof first[key] === 'string');

    if (!numericKey || !categoryKey) {
      return { chartType: 'table' };
    }

    return {
      chartType: 'bar',
      xKey: categoryKey,
      yKey: numericKey,
    };
  }
}
