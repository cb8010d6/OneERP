import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CrudService } from '../crud/crud.service';
import { MetadataService } from '../metadata/metadata.service';
import { WorkflowService } from '../workflow/workflow.service';
import { LlmAdapterService } from './llm-adapter.service';

export interface AIToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface AICommandOptions {
  dryRun?: boolean;
  overrideTool?: {
    toolName: string;
    args: Record<string, unknown>;
  };
}

type JsonRecord = Record<string, unknown>;

interface ReceivableInvoiceRow {
  amount: unknown;
  payments: Array<{ amount: unknown }>;
  order?: {
    partner?: {
      name?: unknown;
    } | null;
  } | null;
}

@Injectable()
export class AIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crudService: CrudService,
    private readonly metadataService: MetadataService,
    private readonly workflowService: WorkflowService,
    private readonly llmAdapterService: LlmAdapterService,
  ) {}

  private toSafeText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  private readStringArg(args: Record<string, unknown>, key: string): string {
    return this.toSafeText(args[key]).trim();
  }

  private readOptionalStringArg(
    args: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = this.readStringArg(args, key);
    return value || undefined;
  }

  private readRecordArg(
    args: Record<string, unknown>,
    key: string,
  ): JsonRecord {
    const value = args[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonRecord;
    }

    return {};
  }

  async getToolSchemas(): Promise<AIToolSchema[]> {
    const models = (await this.metadataService.listSchemas()).map(
      (schema) => schema.model,
    );

    return [
      {
        name: 'create_resource',
        description: '用来对任意模型创建记录 create_resource(modelName, data)',
        parameters: {
          type: 'object',
          properties: {
            modelName: { type: 'string', enum: models },
            data: { type: 'object' },
          },
          required: ['modelName', 'data'],
        },
      },
      {
        name: 'transition_workflow',
        description:
          '执行工作流流转 transition_workflow(modelName, recordId, action, note)',
        parameters: {
          type: 'object',
          properties: {
            modelName: {
              type: 'string',
              enum: ['order', 'workOrder', 'invoice'],
            },
            recordId: { type: 'string' },
            action: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['modelName', 'recordId', 'action'],
        },
      },
      {
        name: 'chat2dash_query',
        description: '分析聚合查询 chat2dash_query(question)',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
          },
          required: ['question'],
        },
      },
      {
        name: 'chat2sql_read',
        description: '执行只读分析查询 chat2sql_read(question)',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
          },
          required: ['question'],
        },
      },
      {
        name: 'parse_document_draft',
        description: '根据上传单据生成草稿字段 parse_document_draft(fileName)',
        parameters: {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
          },
          required: ['fileName'],
        },
      },
    ];
  }

  async command(
    input: string,
    companyId: string,
    userId: string,
    options?: AICommandOptions,
  ) {
    const text = input.trim();
    if (!text) {
      throw new BadRequestException('指令不能为空');
    }

    const dryRun = options?.dryRun !== false;
    if (options?.overrideTool?.toolName) {
      if (dryRun && this.isWriteTool(options.overrideTool.toolName)) {
        return this.buildDraftResponse(
          text,
          options.overrideTool.toolName,
          options.overrideTool.args,
        );
      }

      const executed = await this.executeToolCall(
        options.overrideTool.toolName,
        options.overrideTool.args,
        companyId,
        userId,
      );
      if (executed) {
        return executed;
      }
    }

    const toolSchemas = await this.getToolSchemas();
    const llmCall = await this.llmAdapterService.resolveToolCall(
      text,
      toolSchemas,
    );
    if (llmCall) {
      if (dryRun && this.isWriteTool(llmCall.toolName)) {
        return this.buildDraftResponse(text, llmCall.toolName, llmCall.args);
      }

      const executed = await this.executeToolCall(
        llmCall.toolName,
        llmCall.args,
        companyId,
        userId,
      );
      if (executed) {
        return executed;
      }
    }

    if (
      text.includes('欠我们多少钱') ||
      text.includes('应收') ||
      text.includes('欠款')
    ) {
      return this.buildReceivableWidget(text, companyId);
    }

    if (
      text.includes('创建') &&
      (text.includes('客户') || text.includes('伙伴'))
    ) {
      if (dryRun) {
        return this.buildDraftResponse(text, 'create_resource', {
          modelName: 'partner',
          data: { name: this.extractName(text) ?? 'AI客户', type: 'CUSTOMER' },
        });
      }
      return this.createPartnerByPrompt(text, companyId);
    }

    if (text.includes('创建') && text.includes('订单')) {
      if (dryRun) {
        return this.buildDraftResponse(text, 'create_resource', {
          modelName: 'order',
          data: { status: 'DRAFT' },
        });
      }
      return this.createOrderByPrompt(text, companyId, userId);
    }

    if (
      text.includes('订单') &&
      (text.includes('发货') ||
        text.includes('提交') ||
        text.includes('完成') ||
        text.includes('取消') ||
        text.includes('生产'))
    ) {
      if (dryRun) {
        return this.buildDraftResponse(text, 'transition_workflow', {
          modelName: 'order',
          action: this.extractOrderAction(text),
          recordId: this.extractOrderNo(text),
        });
      }
      return this.transitionOrderByPrompt(text, companyId, userId);
    }

    return {
      type: 'clarify',
      message: '暂未识别该指令。可尝试：创建客户、创建订单、订单流转。',
      tools: toolSchemas,
    };
  }

  async chat2dash(input: string, companyId: string) {
    const rangeDays = this.resolveRangeDays(input);
    const start = new Date();
    start.setDate(start.getDate() - rangeDays);

    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        companyId,
        createdAt: { gte: start },
      },
      _count: { _all: true },
    });

    return {
      type: 'chart',
      title: `最近 ${rangeDays} 天订单状态分布`,
      chart: {
        library: 'recharts',
        chartType: 'bar',
        xKey: 'status',
        yKey: 'count',
        data: grouped.map((item) => ({
          status: item.status,
          count: item._count._all,
        })),
      },
      insight: grouped.length
        ? '可优先关注 PENDING / IN_PRODUCTION 的积压。'
        : '该时间窗口内暂无订单数据。',
    };
  }

  async chat2sql(input: string, companyId: string) {
    const schemaContext = this.buildReadSchemaContext();
    const sql = await this.llmAdapterService.resolveReadSql(
      input,
      schemaContext,
    );

    if (!sql) {
      throw new BadRequestException('未生成可执行查询，请重试更具体的问题');
    }

    const checkedSql = this.validateReadOnlySql(sql);
    const rows: Array<Record<string, unknown>> =
      await this.prisma.$queryRawUnsafe(checkedSql, companyId);

    const chartSuggestion = this.suggestChart(rows);
    return {
      type: 'table',
      title: 'Chat2SQL 查询结果',
      sql: checkedSql,
      rows,
      chartSuggestion,
      rowCount: rows.length,
    };
  }

  async parseDocumentDraft(
    file: { originalname: string; mimetype: string; size: number } | undefined,
    companyId: string,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }

    const name = file.originalname ?? 'document';
    const fallbackDraft = {
      supplierName: this.extractLikelySupplierFromFileName(name),
      amount: 0,
      taxRate: 0.13,
      invoiceNo: '',
      lines: [],
      companyId,
      sourceFileName: name,
      sourceMimeType: file.mimetype,
      sourceSize: file.size,
    };

    const llmDraft = await this.llmAdapterService.resolveDocumentDraft(name);
    return {
      type: 'draft',
      message: '单据解析完成，请确认草稿后再落库。',
      draft: llmDraft ?? fallbackDraft,
    };
  }

  private resolveRangeDays(text: string) {
    if (text.includes('90')) return 90;
    if (text.includes('30') || text.includes('一个月')) return 30;
    return 7;
  }

  private extractName(text: string) {
    const patterns = [
      /名称[是为:]?\s*([^，。]+)/,
      /叫\s*([^，。]+)/,
      /创建.*?(客户|伙伴)([^，。]+)/,
    ];
    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched?.[2]) return matched[2].trim();
      if (matched?.[1]) return matched[1].trim();
    }
    return undefined;
  }

  private extractPartnerKeyword(text: string) {
    const candidates = [
      text.match(/查一下(.+?)欠/),
      text.match(/查询(.+?)欠/),
      text.match(/(.+?)欠我们多少钱/),
      text.match(/(微软|阿里|腾讯|华为|字节|百度)/),
    ];

    for (const candidate of candidates) {
      if (candidate?.[1]) {
        return candidate[1].trim();
      }
    }

    return undefined;
  }

  private extractQuantity(text: string) {
    const matched = text.match(/(\d+)\s*(台|件|个|套)?/);
    if (!matched) return 1;
    const qty = Number(matched[1]);
    return Number.isInteger(qty) && qty > 0 ? qty : 1;
  }

  private extractOrderNo(text: string) {
    const strict = text.match(/ORD-\d{6}-\d+/i);
    if (strict?.[0]) return strict[0].toUpperCase();

    const loose = text.match(/订单\s*([A-Za-z0-9-]+)/);
    return loose?.[1];
  }

  private extractOrderAction(text: string) {
    if (text.includes('提交')) return 'submit';
    if (
      text.includes('开始生产') ||
      text.includes('开工') ||
      text.includes('生产')
    )
      return 'start_production';
    if (text.includes('发货')) return 'ship';
    if (text.includes('完成')) return 'complete';
    if (text.includes('取消')) return 'cancel';
    return undefined;
  }

  private async createPartnerByPrompt(text: string, companyId: string) {
    const name =
      this.extractName(text) || `AI客户-${Date.now().toString().slice(-6)}`;

    const created = await this.crudService.create(
      'partner',
      {
        name,
        type: 'CUSTOMER',
        contact: '',
        phone: '',
      },
      companyId,
    );

    const record = created as Record<string, unknown>;
    return {
      type: 'tool_result',
      tool: 'create_resource',
      message: `已创建客户 ${name}`,
      card: {
        modelName: 'partner',
        id: this.toSafeText(record.id),
        name: this.toSafeText(record.name),
      },
    };
  }

  private async createOrderByPrompt(
    text: string,
    companyId: string,
    userId: string,
  ) {
    const quantity = this.extractQuantity(text);

    const partner = await this.prisma.partner.findFirst({
      where: { companyId, type: { in: ['CUSTOMER', 'BOTH'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!partner) {
      throw new BadRequestException('没有可用客户，请先创建客户。');
    }

    const product = await this.prisma.product.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
    if (!product) {
      throw new BadRequestException('没有可用产品，请先维护产品主数据。');
    }

    const created = await this.crudService.create(
      'order',
      {
        partnerId: partner.id,
        salesId: userId,
        status: 'DRAFT',
        totalAmount: 0,
        aiSummary: { source: 'v1_ai_command', prompt: text },
        items: {
          create: [
            {
              productId: product.id,
              quantity,
              unitPrice: 0,
              totalPrice: 0,
            },
          ],
        },
      },
      companyId,
    );

    const record = created as Record<string, unknown>;

    return {
      type: 'tool_result',
      tool: 'create_resource',
      message: `已创建草稿订单 ${this.toSafeText(record.orderNo)}`,
      card: {
        modelName: 'order',
        id: this.toSafeText(record.id),
        orderNo: this.toSafeText(record.orderNo),
        status: this.toSafeText(record.status),
      },
    };
  }

  private async transitionOrderByPrompt(
    text: string,
    companyId: string,
    userId: string,
  ) {
    const orderNo = this.extractOrderNo(text);
    const action = this.extractOrderAction(text);

    if (!orderNo || !action) {
      throw new BadRequestException(
        '请给出订单号和动作，例如：把订单 ORD-202603-1234 标记为发货',
      );
    }

    const order = await this.prisma.order.findFirst({
      where: { companyId, orderNo },
      select: { id: true, orderNo: true },
    });

    if (!order) {
      throw new BadRequestException(`未找到订单 ${orderNo}`);
    }

    const transitioned = await this.workflowService.transition(
      'order',
      order.id,
      action,
      companyId,
      userId,
      'AI Command',
    );

    return {
      type: 'tool_result',
      tool: 'transition_workflow',
      message: `订单 ${order.orderNo} 已流转到 ${transitioned.to}`,
      card: {
        modelName: 'order',
        id: order.id,
        orderNo: order.orderNo,
        from: transitioned.from,
        to: transitioned.to,
      },
    };
  }

  private async buildReceivableWidget(text: string, companyId: string) {
    const keyword = this.extractPartnerKeyword(text);

    const invoices = (await this.prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: ['UNPAID', 'PARTIAL'] },
        order: keyword
          ? {
              partner: {
                name: {
                  contains: keyword,
                  mode: 'insensitive',
                },
              },
            }
          : undefined,
      },
      include: {
        payments: { select: { amount: true } },
        order: {
          include: {
            partner: { select: { name: true } },
          },
        },
      },
      take: 100,
    })) as ReceivableInvoiceRow[];

    const totalReceivable = invoices.reduce((sum, invoice) => {
      const paid = invoice.payments.reduce(
        (acc, payment) => acc + Number(payment.amount),
        0,
      );
      const remaining = Number(invoice.amount) - paid;
      return sum + Math.max(remaining, 0);
    }, 0);

    const partnerName =
      this.toSafeText(keyword) ||
      this.toSafeText(invoices[0]?.order?.partner?.name) ||
      '全部客户';

    return {
      type: 'tool_result',
      tool: 'chat2dash_query',
      message: `${partnerName} 当前应收账款为 ¥${totalReceivable.toLocaleString()}`,
      card: {
        widgetType: 'receivable',
        partnerName,
        amount: totalReceivable,
        unpaidCount: invoices.length,
      },
    };
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    companyId: string,
    userId: string,
  ) {
    if (toolName === 'create_resource') {
      const modelName = this.readStringArg(args, 'modelName');
      const data = this.readRecordArg(args, 'data');
      if (!modelName) {
        return null;
      }

      const created = await this.crudService.create(modelName, data, companyId);
      const record = created as Record<string, unknown>;
      return {
        type: 'tool_result',
        tool: toolName,
        message: `已创建 ${modelName} 记录`,
        card: {
          modelName,
          id: record.id,
          ...record,
        },
      };
    }

    if (toolName === 'transition_workflow') {
      const modelName = this.readStringArg(args, 'modelName');
      const recordId = this.readStringArg(args, 'recordId');
      const action = this.readStringArg(args, 'action');
      const note = this.readOptionalStringArg(args, 'note');

      if (!modelName || !recordId || !action) {
        return null;
      }

      const result = await this.workflowService.transition(
        modelName,
        recordId,
        action,
        companyId,
        userId,
        note,
      );

      return {
        type: 'tool_result',
        tool: toolName,
        message: `${modelName} 已执行 ${action}`,
        card: {
          modelName,
          id: recordId,
          from: result.from,
          to: result.to,
        },
      };
    }

    if (toolName === 'chat2dash_query') {
      const question = this.readStringArg(args, 'question');
      if (!question) {
        return null;
      }
      return this.chat2dash(question, companyId);
    }

    if (toolName === 'chat2sql_read') {
      const question = this.readStringArg(args, 'question');
      if (!question) {
        return null;
      }
      return this.chat2sql(question, companyId);
    }

    return null;
  }

  private isWriteTool(toolName: string) {
    return ['create_resource', 'transition_workflow'].includes(toolName);
  }

  private buildDraftResponse(
    originalInput: string,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    return {
      type: 'draft',
      message: '已生成执行草稿，请确认后执行。',
      draft: {
        originalInput,
        toolName,
        args,
        writeEnabled: process.env.AI_WRITE_ENABLED === 'true',
      },
    };
  }

  private buildReadSchemaContext() {
    return `
Tables:
- "Order"(id, orderNo, status, totalAmount, companyId, createdAt)
- "Invoice"(id, invoiceNo, amount, status, postingStatus, companyId, issuedDate)
- "Payment"(id, invoiceId, amount, method, paymentDate)
- "Partner"(id, name, type, companyId)
- "InventoryTransaction"(id, type, materialId, quantity, companyId, createdAt)
- "Material"(id, sku, name, category, unitPrice, companyId)
- "JournalEntry"(id, entryNo, date, ref, companyId)
- "JournalEntryLine"(id, journalEntryId, accountId, debit, credit)

Rules:
1) SQL must be read-only SELECT.
2) Must include filter: "companyId" = $1 on company scoped table.
3) No CTE, no semicolon, no DDL/DML.
    `.trim();
  }

  private validateReadOnlySql(sql: string) {
    const normalized = sql.trim();
    const lowered = normalized.toLowerCase();

    if (!lowered.startsWith('select')) {
      throw new BadRequestException('只允许 SELECT 查询');
    }

    const forbidden = [
      'insert',
      'update',
      'delete',
      'drop',
      'alter',
      'create',
      'truncate',
      ';',
      'with ',
      'pg_',
      'information_schema',
    ];

    if (forbidden.some((keyword) => lowered.includes(keyword))) {
      throw new BadRequestException('检测到不安全 SQL 关键字');
    }

    const hasCompanyFilter =
      lowered.includes('companyid') &&
      (lowered.includes('$1') || lowered.includes('?'));
    if (!hasCompanyFilter) {
      throw new BadRequestException('查询必须包含 companyId 过滤');
    }

    return normalized;
  }

  private suggestChart(rows: Array<Record<string, unknown>>) {
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

  private extractLikelySupplierFromFileName(fileName: string) {
    const cleaned = fileName.replace(/\.[^.]+$/, '');
    const parts = cleaned.split(/[_\-\s]+/).filter(Boolean);
    return parts[0] ?? '待识别供应商';
  }
}
