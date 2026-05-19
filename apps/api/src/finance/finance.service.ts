import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntryPostingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, CreatePaymentDto } from './dto/finance.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import { roundDecimal } from '../core/utils/decimal';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface TrialBalanceResult {
  startDate: string | null;
  endDate: string | null;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
  rows: TrialBalanceRow[];
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private round2(value: number) {
    return roundDecimal(value);
  }

  private calcTaxFromTotal(total: number, taxRate: number) {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));
    const subTotal = this.round2(total / (1 + safeRate));
    const taxAmount = this.round2(total - subTotal);
    return { subTotal, taxAmount, taxRate: safeRate };
  }

  private parseTrialBalanceDate(
    value: string | undefined,
    fieldName: 'startDate' | 'endDate',
  ) {
    if (!value) return undefined;

    const normalized =
      fieldName === 'endDate' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T23:59:59.999Z`
        : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} 日期格式无效`);
    }
    return date;
  }

  private async resolveTaxCode(companyId: string, taxCodeId?: string | null) {
    if (taxCodeId) {
      const taxCode = await this.prisma.taxCode.findFirst({
        where: { id: taxCodeId, companyId, active: true },
      });
      if (!taxCode) {
        throw new BadRequestException('税码不存在或已停用，请确认税码选择');
      }
      return { ...taxCode, isFallback: false };
    }

    const defaultTaxCode = await this.prisma.taxCode.findFirst({
      where: { companyId, isDefault: true, active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (defaultTaxCode) {
      return { ...defaultTaxCode, isFallback: false };
    }

    this.logger.warn(`未配置默认税码，发票将使用 13% 默认税率: ${companyId}`);
    return { id: null, rate: 0.13, isFallback: true };
  }

  async createInvoice(
    companyId: string,
    dto: CreateInvoiceDto,
    operatorId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
      select: { id: true, taxCodeId: true },
    });
    if (!order) throw new NotFoundException('找不到销售订单');

    const resolvedTaxCode = await this.resolveTaxCode(
      companyId,
      dto.taxCodeId ?? order.taxCodeId,
    );

    const amount = this.round2(Number(dto.amount));
    const breakdown = this.calcTaxFromTotal(
      amount,
      Number(resolvedTaxCode.rate ?? 0),
    );

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNo: `INV-${Date.now()}`,
        orderId: dto.orderId,
        amount,
        subTotal: breakdown.subTotal,
        taxAmount: breakdown.taxAmount,
        taxCodeId: resolvedTaxCode.id ?? null,
        dueDate: new Date(dto.dueDate),
        status: 'UNPAID',
        postingStatus: EntryPostingStatus.DRAFT,
        companyId,
      },
    });

    // 记录审计日志
    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'CREATE_INVOICE',
        entity: 'Invoice',
        entityId: invoice.id,
        details: {
          amount,
          orderId: dto.orderId,
          taxCodeId: resolvedTaxCode.id ?? null,
          taxRate: resolvedTaxCode.rate ?? 0,
          taxFallback: resolvedTaxCode.isFallback ?? false,
        },
        companyId,
      },
    });

    return invoice;
  }

  async getInvoices(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { order: true, payments: true },
        orderBy: { issuedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: CreatePaymentDto,
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { payments: true },
    });
    if (!inv) throw new NotFoundException('发票不存在');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          method: dto.method,
        },
      });

      const totalPaid =
        inv.payments.reduce(
          (sum, p) => this.round2(sum + Number(p.amount)),
          0,
        ) + this.round2(Number(dto.amount));

      const invoiceAmount = this.round2(Number(inv.amount));
      let newStatus = inv.status;
      if (totalPaid >= invoiceAmount) newStatus = 'PAID';
      else if (totalPaid > 0) newStatus = 'PARTIAL';

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      });

      return payment;
    });
  }

  async postInvoice(
    companyId: string,
    invoiceId: string,
    operatorId: string,
    taxCodeId?: string,
    taxRate?: number,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { order: { select: { taxCodeId: true } } },
    });
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }

    if (invoice.postingStatus === EntryPostingStatus.POSTED) {
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        postingStatus: invoice.postingStatus,
        message: '发票已过账，无需重复处理',
      };
    }

    const resolvedTaxCode = await this.resolveTaxCode(
      companyId,
      taxCodeId ?? invoice.taxCodeId ?? invoice.order?.taxCodeId,
    );
    const amount = this.round2(Number(invoice.amount));
    let subTotal = this.round2(Number(invoice.subTotal ?? 0));
    let taxAmount = this.round2(Number(invoice.taxAmount ?? 0));
    const shouldRecalc = subTotal <= 0 && taxAmount <= 0 && amount > 0;

    if (shouldRecalc) {
      const fallbackRate = taxRate ?? resolvedTaxCode.rate ?? 0.13;
      const breakdown = this.calcTaxFromTotal(amount, Number(fallbackRate));
      subTotal = breakdown.subTotal;
      taxAmount = breakdown.taxAmount;
    }

    const updateData: Prisma.InvoiceUpdateInput = {
      postingStatus: EntryPostingStatus.POSTED,
    };
    if (shouldRecalc) {
      updateData.subTotal = subTotal;
      updateData.taxAmount = taxAmount;
    }
    if (!invoice.taxCodeId && resolvedTaxCode.id) {
      updateData.taxCode = { connect: { id: resolvedTaxCode.id } };
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: updateData,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_INVOICE',
        entity: 'invoice',
        entityId: invoice.id,
        details: {
          invoiceNo: invoice.invoiceNo,
          taxCodeId: invoice.taxCodeId ?? resolvedTaxCode.id ?? null,
          taxRate: taxRate ?? resolvedTaxCode.rate ?? 0.13,
          taxFallback: resolvedTaxCode.isFallback ?? false,
        },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.invoice.posted', {
      companyId,
      idempotencyKey: `invoice_posted:${invoice.id}`,
      invoiceId: invoice.id,
      taxCodeId: invoice.taxCodeId ?? resolvedTaxCode.id ?? null,
      taxRate: taxRate ?? resolvedTaxCode.rate ?? 0.13,
      operatorId,
    });

    return updated;
  }

  async getTrialBalance(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<TrialBalanceResult> {
    const parsedStartDate = this.parseTrialBalanceDate(startDate, 'startDate');
    const parsedEndDate = this.parseTrialBalanceDate(endDate, 'endDate');

    if (
      parsedStartDate &&
      parsedEndDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const journalEntryWhere: Prisma.JournalEntryWhereInput = {
      companyId,
      postingStatus: EntryPostingStatus.POSTED,
    };
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parsedStartDate) dateFilter.gte = parsedStartDate;
    if (parsedEndDate) dateFilter.lte = parsedEndDate;
    if (Object.keys(dateFilter).length > 0) {
      journalEntryWhere.date = dateFilter;
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { journalEntry: journalEntryWhere },
      include: { account: true },
    });

    const rowsByAccount = new Map<string, TrialBalanceRow>();
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      const debit = this.round2(Number(line.debit ?? 0));
      const credit = this.round2(Number(line.credit ?? 0));
      totalDebit = this.round2(totalDebit + debit);
      totalCredit = this.round2(totalCredit + credit);

      const existing = rowsByAccount.get(line.accountId);
      if (existing) {
        existing.debit = this.round2(existing.debit + debit);
        existing.credit = this.round2(existing.credit + credit);
        existing.balance = this.round2(existing.debit - existing.credit);
        continue;
      }

      rowsByAccount.set(line.accountId, {
        accountId: line.accountId,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit,
        credit,
        balance: this.round2(debit - credit),
      });
    }

    const rows = [...rowsByAccount.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    const difference = this.round2(totalDebit - totalCredit);

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate?.toISOString() ?? null,
      totalDebit,
      totalCredit,
      difference,
      balanced: Math.abs(difference) < 0.01,
      rows,
    };
  }
}
