import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntryPostingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCreditNoteDto,
  CreateInvoiceDto,
  ImportBankStatementLinesDto,
  MatchBankStatementLineDto,
  CreatePaymentDto,
  CreateReceivablePaymentDto,
  ApplyReceivablePaymentDto,
  CreateCustomerRefundDto,
} from './dto/finance.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import { roundDecimal } from '../core/utils/decimal';
import { FinanceAccountMappingService } from './finance-account-mapping.service';
import { AccountingPeriodService } from './accounting-period.service';
import { FinanceReportsService } from './finance-reports.service';
import { CustomerStatementService } from './customer-statement.service';
import { BankStatementService } from './bank-statement.service';
import { FinanceQueryService } from './finance-query.service';

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

export interface GeneralLedgerLine {
  lineId: string;
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  lineNo: number;
  partnerName: string | null;
  memo: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: GeneralLedgerLine[];
}

export interface GeneralLedgerResult {
  startDate: string | null;
  endDate: string;
  accountCode: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  accounts: GeneralLedgerAccount[];
}

export interface IncomeStatementRow {
  accountId: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  debit: number;
  credit: number;
  amount: number;
}

export interface IncomeStatementResult {
  startDate: string | null;
  endDate: string | null;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  rows: IncomeStatementRow[];
}

export interface BalanceSheetRow {
  accountId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY';
  debit: number;
  credit: number;
  amount: number;
}

export interface BalanceSheetResult {
  asOfDate: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentEarnings: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  balanced: boolean;
  rows: BalanceSheetRow[];
}

export type CashFlowCategory = 'OPERATING' | 'INVESTING' | 'FINANCING';

export interface CashFlowRow {
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  accountCode: string;
  accountName: string;
  category: CashFlowCategory;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
}

export interface CashFlowResult {
  startDate: string | null;
  endDate: string;
  beginningCash: number;
  totalCashInflow: number;
  totalCashOutflow: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashFlow: number;
  endingCash: number;
  cashAccountCodes: string[];
  rows: CashFlowRow[];
}

export interface ReceivableAgingRow {
  invoiceId: string;
  invoiceNo: string;
  orderNo: string | null;
  partnerId: string | null;
  partnerName: string | null;
  issuedDate: string;
  dueDate: string | null;
  daysOverdue: number;
  amount: number;
  paidAmount: number;
  creditedAmount: number;
  openAmount: number;
  bucket:
    | 'CURRENT'
    | 'DAYS_1_30'
    | 'DAYS_31_60'
    | 'DAYS_61_90'
    | 'DAYS_90_PLUS';
}

export interface ReceivableAgingResult {
  asOfDate: string;
  totalOpen: number;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  rows: ReceivableAgingRow[];
}

export interface UnappliedPaymentRow {
  paymentId: string;
  partnerId: string;
  partnerName: string;
  paymentDate: string;
  method: string;
  amount: number;
  allocatedAmount: number;
  unappliedAmount: number;
  postingStatus: EntryPostingStatus;
}

export interface InventoryValuationReconciliationRow {
  materialId: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  averageCost: number;
  inventoryValue: number;
}

export interface InventoryValuationGeneralLedgerLine {
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface InventoryValuationPendingEvent {
  id: string;
  eventName: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  updatedAt: string;
  error: string | null;
}

type InventoryValuationPayableMatchStatus =
  | 'PARTIAL_RECEIPT'
  | 'OVER_RECEIPT'
  | 'PRICE_VARIANCE'
  | 'MATCHED';

export interface InventoryValuationUnpostedPurchaseInvoice {
  id: string;
  invoiceNo: string;
  purchaseOrderId: string;
  purchaseNo: string;
  supplierName: string;
  issuedDate: string;
  amount: number;
  postingStatus: EntryPostingStatus;
  matchStatus: InventoryValuationPayableMatchStatus;
  isPostable: boolean;
  matchReasons: string[];
  amountVariance: number;
}

export interface InventoryValuationDiagnostics {
  recentGeneralLedgerLines: InventoryValuationGeneralLedgerLine[];
  pendingEvents: InventoryValuationPendingEvent[];
  unpostedPurchaseInvoices: InventoryValuationUnpostedPurchaseInvoice[];
}

export interface InventoryValuationReconciliationResult {
  asOfDate: string;
  inventoryAccount: {
    code: string;
    name: string;
    type: string;
  };
  inventoryValue: number;
  generalLedgerBalance: number;
  difference: number;
  reconciled: boolean;
  materialCount: number;
  rows: InventoryValuationReconciliationRow[];
  diagnostics: InventoryValuationDiagnostics;
}

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly financeAccountMappingService: FinanceAccountMappingService,
    private readonly financeReportsService: FinanceReportsService,
    private readonly customerStatementService: CustomerStatementService,
    private readonly bankStatementService: BankStatementService,
    private readonly financeQueryService: FinanceQueryService,
    @Optional()
    private readonly accountingPeriodService?: AccountingPeriodService,
  ) {}

  private async assertAccountingPeriodOpen(companyId: string, date: Date) {
    await this.accountingPeriodService?.assertOpenForDate(companyId, date);
  }

  private calcTaxFromTotal(total: number, taxRate: number) {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));
    const subTotal = roundDecimal(total / (1 + safeRate));
    const taxAmount = roundDecimal(total - subTotal);
    return { subTotal, taxAmount, taxRate: safeRate };
  }

  private paidAmount(
    allocations?: Array<{ amount: Prisma.Decimal | number | string }>,
  ) {
    return roundDecimal(
      (allocations ?? []).reduce(
        (sum, allocation) => sum + Number(allocation.amount),
        0,
      ),
    );
  }

  private postedCreditAmount(
    creditNotes?: Array<{
      amount: Prisma.Decimal | number | string;
      postingStatus?: EntryPostingStatus;
    }>,
  ) {
    return roundDecimal(
      (creditNotes ?? [])
        .filter((creditNote) => creditNote.postingStatus === 'POSTED')
        .reduce((sum, creditNote) => sum + Number(creditNote.amount), 0),
    );
  }

  private postedRefundAmount(
    refunds?: Array<{
      amount: Prisma.Decimal | number | string;
      postingStatus?: EntryPostingStatus;
    }>,
  ) {
    return roundDecimal(
      (refunds ?? [])
        .filter((refund) => refund.postingStatus === 'POSTED')
        .reduce((sum, refund) => sum + Number(refund.amount), 0),
    );
  }

  private settlementStatus(
    invoiceAmount: number,
    paidAmount: number,
    creditedAmount: number,
  ) {
    const settled = roundDecimal(paidAmount + creditedAmount);
    if (settled >= roundDecimal(invoiceAmount - 0.01)) return 'PAID';
    if (settled > 0) return 'PARTIAL';
    return 'UNPAID';
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

  private parseAsOfDate(value?: string) {
    if (!value) return new Date();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T23:59:59.999Z`
      : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('asOfDate 日期格式无效');
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

    const amount = roundDecimal(Number(dto.amount));
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
    return this.financeQueryService.getInvoices(companyId, pagination);
  }

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: CreatePaymentDto,
    operatorId?: string,
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        order: { select: { partnerId: true } },
        paymentAllocations: { select: { amount: true } },
        creditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
      },
    });
    if (!inv) throw new NotFoundException('发票不存在');

    if (inv.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('发票尚未过账，不能登记收款');
    }

    const paymentAmount = roundDecimal(Number(dto.amount));
    if (paymentAmount <= 0) {
      throw new BadRequestException('收款金额必须大于0');
    }

    const existingPaid = this.paidAmount(inv.paymentAllocations);
    const existingCredited = this.postedCreditAmount(inv.creditNotes);
    const totalPaid = roundDecimal(existingPaid + paymentAmount);
    const invoiceAmount = roundDecimal(Number(inv.amount));

    if (
      roundDecimal(totalPaid + existingCredited) >
      roundDecimal(invoiceAmount + 0.01)
    ) {
      throw new BadRequestException('收款金额超过发票剩余应收');
    }

    const paymentDate = new Date();
    await this.assertAccountingPeriodOpen(companyId, paymentDate);

    const payment = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          partnerId: inv.order.partnerId,
          amount: paymentAmount,
          method: dto.method,
          companyId,
          postingStatus: EntryPostingStatus.DRAFT,
        },
      });

      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId,
          amount: paymentAmount,
          companyId,
        },
      });

      const newStatus = this.settlementStatus(
        invoiceAmount,
        totalPaid,
        existingCredited,
      );

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      });

      return payment;
    });

    this.eventEmitter.emit('finance.payment.recorded', {
      companyId,
      idempotencyKey: `payment_recorded:${payment.id}`,
      paymentId: payment.id,
      operatorId,
    });

    return payment;
  }

  async recordReceivablePayment(
    companyId: string,
    dto: CreateReceivablePaymentDto,
    operatorId?: string,
  ) {
    const partner = await this.prisma.partner.findFirst({
      where: {
        id: dto.partnerId,
        companyId,
        isActive: true,
        type: { in: ['CUSTOMER', 'BOTH'] },
      },
      select: { id: true },
    });
    if (!partner) {
      throw new BadRequestException('客户不存在或已停用');
    }

    const paymentAmount = roundDecimal(Number(dto.amount));
    if (paymentAmount <= 0) {
      throw new BadRequestException('收款金额必须大于0');
    }

    const allocationMap = new Map<string, number>();
    for (const allocation of dto.allocations ?? []) {
      const amount = roundDecimal(Number(allocation.amount));
      if (amount <= 0) {
        throw new BadRequestException('核销金额必须大于0');
      }
      if (allocationMap.has(allocation.invoiceId)) {
        throw new BadRequestException('同一发票不能重复分配');
      }
      allocationMap.set(allocation.invoiceId, amount);
    }

    const allocatedTotal = roundDecimal(
      [...allocationMap.values()].reduce((sum, amount) => sum + amount, 0),
    );
    if (allocatedTotal > paymentAmount) {
      throw new BadRequestException('核销金额合计不能超过收款金额');
    }

    const paymentDate = new Date();
    await this.assertAccountingPeriodOpen(companyId, paymentDate);

    const invoiceIds = [...allocationMap.keys()];
    const invoices = invoiceIds.length
      ? await this.prisma.invoice.findMany({
          where: { id: { in: invoiceIds }, companyId },
          include: {
            order: { select: { partnerId: true } },
            paymentAllocations: { select: { amount: true } },
            creditNotes: {
              where: { postingStatus: EntryPostingStatus.POSTED },
              select: { amount: true, postingStatus: true },
            },
          },
        })
      : [];
    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('存在发票不存在或无权访问');
    }

    for (const invoice of invoices) {
      if (invoice.order.partnerId !== dto.partnerId) {
        throw new BadRequestException('只能核销同一客户的应收发票');
      }
      if (invoice.postingStatus !== EntryPostingStatus.POSTED) {
        throw new BadRequestException('存在未过账发票，不能核销收款');
      }

      const allocated = allocationMap.get(invoice.id) ?? 0;
      const existingPaid = this.paidAmount(invoice.paymentAllocations);
      const existingCredited = this.postedCreditAmount(invoice.creditNotes);
      const invoiceAmount = roundDecimal(Number(invoice.amount));
      if (
        roundDecimal(existingPaid + existingCredited + allocated) >
        roundDecimal(invoiceAmount + 0.01)
      ) {
        throw new BadRequestException(
          `发票 ${invoice.invoiceNo} 核销金额超过未结应收`,
        );
      }
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          invoiceId: invoiceIds[0] ?? null,
          partnerId: dto.partnerId,
          amount: paymentAmount,
          method: dto.method,
          companyId,
          postingStatus: EntryPostingStatus.DRAFT,
        },
      });

      for (const [invoiceId, amount] of allocationMap) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: created.id,
            invoiceId,
            amount,
            companyId,
          },
        });
      }

      for (const invoice of invoices) {
        const allocated = allocationMap.get(invoice.id) ?? 0;
        const existingPaid = this.paidAmount(invoice.paymentAllocations);
        const existingCredited = this.postedCreditAmount(invoice.creditNotes);
        const totalPaid = roundDecimal(existingPaid + allocated);
        const invoiceAmount = roundDecimal(Number(invoice.amount));
        const status = this.settlementStatus(
          invoiceAmount,
          totalPaid,
          existingCredited,
        );

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status },
        });
      }

      return created;
    });

    this.eventEmitter.emit('finance.payment.recorded', {
      companyId,
      idempotencyKey: `payment_recorded:${payment.id}`,
      paymentId: payment.id,
      operatorId,
    });

    return payment;
  }

  async getUnappliedPayments(companyId: string) {
    return this.financeQueryService.getUnappliedPayments(companyId);
  }

  async listCustomerOptions(companyId: string) {
    return this.customerStatementService.listCustomerOptions(companyId);
  }

  async getCustomerStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
    partnerId?: string,
  ) {
    return this.customerStatementService.getCustomerStatement(
      companyId,
      startDate,
      endDate,
      partnerId,
    );
  }

  async importBankStatementLines(
    companyId: string,
    dto: ImportBankStatementLinesDto,
  ) {
    return this.bankStatementService.importBankStatementLines(companyId, dto);
  }

  async getBankStatementLines(companyId: string, status?: string) {
    return this.bankStatementService.getBankStatementLines(companyId, status);
  }

  async autoMatchBankStatementLines(companyId: string, operatorId?: string) {
    return this.bankStatementService.autoMatchBankStatementLines(
      companyId,
      operatorId,
    );
  }

  async matchBankStatementLine(
    companyId: string,
    bankStatementLineId: string,
    dto: MatchBankStatementLineDto,
    operatorId?: string,
  ) {
    return this.bankStatementService.matchBankStatementLine(
      companyId,
      bankStatementLineId,
      dto,
      operatorId,
    );
  }

  async applyReceivablePayment(
    companyId: string,
    paymentId: string,
    dto: ApplyReceivablePaymentDto,
    operatorId?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, companyId },
      include: {
        allocations: { select: { amount: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException('收款记录不存在');
    }
    await this.assertAccountingPeriodOpen(companyId, payment.paymentDate);

    const allocationMap = new Map<string, number>();
    for (const allocation of dto.allocations) {
      const amount = roundDecimal(Number(allocation.amount));
      if (amount <= 0) {
        throw new BadRequestException('核销金额必须大于0');
      }
      if (allocationMap.has(allocation.invoiceId)) {
        throw new BadRequestException('同一发票不能重复分配');
      }
      allocationMap.set(allocation.invoiceId, amount);
    }

    const allocatedTotal = roundDecimal(
      [...allocationMap.values()].reduce((sum, amount) => sum + amount, 0),
    );
    if (allocatedTotal <= 0) {
      throw new BadRequestException('核销金额必须大于0');
    }

    const existingAllocated = roundDecimal(
      payment.allocations.reduce(
        (sum, allocation) => sum + Number(allocation.amount),
        0,
      ),
    );
    const unappliedAmount = roundDecimal(
      Number(payment.amount) - existingAllocated,
    );
    if (allocatedTotal > roundDecimal(unappliedAmount + 0.01)) {
      throw new BadRequestException('核销金额超过未分配收款余额');
    }

    const invoiceIds = [...allocationMap.keys()];
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, companyId },
      include: {
        order: { select: { partnerId: true } },
        paymentAllocations: { select: { amount: true } },
        creditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
      },
    });
    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('存在发票不存在或无权访问');
    }

    for (const invoice of invoices) {
      if (invoice.order.partnerId !== payment.partnerId) {
        throw new BadRequestException('只能核销同一客户的应收发票');
      }
      if (invoice.postingStatus !== EntryPostingStatus.POSTED) {
        throw new BadRequestException('存在未过账发票，不能核销收款');
      }

      const allocated = allocationMap.get(invoice.id) ?? 0;
      const existingPaid = this.paidAmount(invoice.paymentAllocations);
      const existingCredited = this.postedCreditAmount(invoice.creditNotes);
      const invoiceAmount = roundDecimal(Number(invoice.amount));
      if (
        roundDecimal(existingPaid + existingCredited + allocated) >
        roundDecimal(invoiceAmount + 0.01)
      ) {
        throw new BadRequestException(
          `发票 ${invoice.invoiceNo} 核销金额超过未结应收`,
        );
      }
    }

    const allocationIds = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const [invoiceId, amount] of allocationMap) {
        const created = await tx.paymentAllocation.create({
          data: {
            paymentId,
            invoiceId,
            amount,
            companyId,
          },
        });
        ids.push(created.id);
      }

      for (const invoice of invoices) {
        const allocated = allocationMap.get(invoice.id) ?? 0;
        const existingPaid = this.paidAmount(invoice.paymentAllocations);
        const existingCredited = this.postedCreditAmount(invoice.creditNotes);
        const totalPaid = roundDecimal(existingPaid + allocated);
        const invoiceAmount = roundDecimal(Number(invoice.amount));
        const status = this.settlementStatus(
          invoiceAmount,
          totalPaid,
          existingCredited,
        );

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status },
        });
      }

      return ids;
    });

    this.eventEmitter.emit('finance.payment.applied', {
      companyId,
      idempotencyKey: `payment_applied:${allocationIds.join(':')}`,
      paymentId,
      allocationIds,
      operatorId,
    });

    return {
      paymentId,
      allocationIds,
      allocatedAmount: allocatedTotal,
    };
  }

  async createCreditNote(
    companyId: string,
    dto: CreateCreditNoteDto,
    operatorId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, companyId },
      include: {
        order: {
          select: { id: true, orderNo: true, partnerId: true, taxCodeId: true },
        },
        paymentAllocations: { select: { amount: true } },
        creditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }
    if (invoice.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('发票尚未过账，不能创建贷项凭证');
    }

    const amount = roundDecimal(Number(dto.amount));
    if (amount <= 0) {
      throw new BadRequestException('贷项金额必须大于0');
    }

    const creditedAmount = this.postedCreditAmount(invoice.creditNotes);
    const invoiceAmount = roundDecimal(Number(invoice.amount));
    const creditableAmount = roundDecimal(invoiceAmount - creditedAmount);
    if (amount > roundDecimal(creditableAmount + 0.01)) {
      throw new BadRequestException('贷项金额超过发票可冲减金额');
    }

    const resolvedTaxCode = await this.resolveTaxCode(
      companyId,
      dto.taxCodeId ?? invoice.taxCodeId ?? invoice.order.taxCodeId,
    );
    const breakdown = this.calcTaxFromTotal(
      amount,
      Number(resolvedTaxCode.rate ?? 0),
    );
    const creditDate = dto.creditDate
      ? this.parseTrialBalanceDate(dto.creditDate, 'startDate')
      : new Date();

    let inventoryReturnDocumentId: string | null = null;
    if (dto.inventoryReturnDocumentId) {
      const returnDocument =
        await this.prisma.inventoryReturnDocument.findFirst({
          where: { id: dto.inventoryReturnDocumentId, companyId },
          include: {
            creditNote: { select: { id: true, creditNo: true } },
          },
        });

      if (!returnDocument) {
        throw new NotFoundException('退货单不存在或无权访问');
      }
      if (returnDocument.returnType !== 'SALES') {
        throw new BadRequestException('只有销售退货单可以关联应收贷项凭证');
      }
      if (returnDocument.status !== 'POSTED') {
        throw new BadRequestException('退货单尚未过账，不能创建贷项凭证');
      }
      if (
        returnDocument.sourceDocumentId !== invoice.order.id &&
        returnDocument.sourceDocumentNo !== invoice.order.orderNo
      ) {
        throw new BadRequestException('退货单与原发票销售订单不匹配');
      }
      if (returnDocument.creditNote) {
        throw new BadRequestException(
          `退货单已关联贷项凭证 ${returnDocument.creditNote.creditNo}`,
        );
      }
      inventoryReturnDocumentId = returnDocument.id;
    }

    const creditNote = await this.prisma.creditNote.create({
      data: {
        creditNo: `CN-${Date.now()}`,
        invoiceId: invoice.id,
        partnerId: invoice.order.partnerId,
        amount,
        subTotal: breakdown.subTotal,
        taxAmount: breakdown.taxAmount,
        taxCodeId: resolvedTaxCode.id ?? null,
        inventoryReturnDocumentId,
        reason: dto.reason ?? null,
        status: 'DRAFT',
        postingStatus: EntryPostingStatus.DRAFT,
        creditDate,
        companyId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'CREATE_CREDIT_NOTE',
        entity: 'CreditNote',
        entityId: creditNote.id,
        details: {
          creditNo: creditNote.creditNo,
          invoiceId: invoice.id,
          amount,
          taxCodeId: resolvedTaxCode.id ?? null,
          inventoryReturnDocumentId,
          reason: dto.reason ?? null,
        },
        companyId,
      },
    });

    return creditNote;
  }

  async getCreditNotes(companyId: string, pagination: PaginationDto) {
    return this.financeQueryService.getCreditNotes(companyId, pagination);
  }

  async postCreditNote(
    companyId: string,
    creditNoteId: string,
    operatorId: string,
  ) {
    const creditNote = await this.prisma.creditNote.findFirst({
      where: { id: creditNoteId, companyId },
      include: {
        invoice: {
          include: {
            paymentAllocations: { select: { amount: true } },
            creditNotes: {
              where: { postingStatus: EntryPostingStatus.POSTED },
              select: { id: true, amount: true, postingStatus: true },
            },
          },
        },
      },
    });
    if (!creditNote) {
      throw new NotFoundException('贷项凭证不存在');
    }
    if (creditNote.postingStatus === EntryPostingStatus.POSTED) {
      return {
        creditNoteId: creditNote.id,
        creditNo: creditNote.creditNo,
        postingStatus: creditNote.postingStatus,
        message: '贷项凭证已过账，无需重复处理',
      };
    }
    if (creditNote.invoice.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('原发票尚未过账，不能过账贷项凭证');
    }
    await this.assertAccountingPeriodOpen(companyId, creditNote.creditDate);

    const invoiceAmount = roundDecimal(Number(creditNote.invoice.amount));
    const paidAmount = this.paidAmount(creditNote.invoice.paymentAllocations);
    const creditedAmount = this.postedCreditAmount(
      creditNote.invoice.creditNotes,
    );
    const amount = roundDecimal(Number(creditNote.amount));
    if (
      roundDecimal(creditedAmount + amount) > roundDecimal(invoiceAmount + 0.01)
    ) {
      throw new BadRequestException('贷项金额超过发票可冲减金额');
    }

    const openReceivable = roundDecimal(
      Math.max(0, invoiceAmount - paidAmount - creditedAmount),
    );
    const receivableAppliedAmount = roundDecimal(
      Math.min(amount, openReceivable),
    );
    const refundLiabilityAmount = roundDecimal(
      Math.max(0, amount - receivableAppliedAmount),
    );

    const status = this.settlementStatus(
      invoiceAmount,
      paidAmount,
      roundDecimal(creditedAmount + receivableAppliedAmount),
    );
    const posted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditNote.update({
        where: { id: creditNote.id },
        data: {
          status: 'POSTED',
          postingStatus: EntryPostingStatus.POSTED,
          receivableAppliedAmount,
          refundLiabilityAmount,
          postedAt: new Date(),
        },
      });
      await tx.invoice.update({
        where: { id: creditNote.invoiceId },
        data: { status },
      });
      return updated;
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_CREDIT_NOTE',
        entity: 'CreditNote',
        entityId: creditNote.id,
        details: {
          creditNo: creditNote.creditNo,
          invoiceId: creditNote.invoiceId,
          amount,
        },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.credit_note.posted', {
      companyId,
      idempotencyKey: `credit_note_posted:${creditNote.id}`,
      creditNoteId: creditNote.id,
      operatorId,
    });

    return posted;
  }

  async createCustomerRefund(
    companyId: string,
    dto: CreateCustomerRefundDto,
    operatorId: string,
  ) {
    const creditNote = await this.prisma.creditNote.findFirst({
      where: { id: dto.creditNoteId, companyId },
      include: {
        refunds: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
      },
    });
    if (!creditNote) {
      throw new NotFoundException('贷项凭证不存在');
    }
    if (creditNote.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('贷项凭证尚未过账，不能退款');
    }

    const amount = roundDecimal(Number(dto.amount));
    if (amount <= 0) {
      throw new BadRequestException('退款金额必须大于0');
    }

    const refundedAmount = this.postedRefundAmount(creditNote.refunds);
    const refundableAmount = roundDecimal(
      Number(creditNote.refundLiabilityAmount) - refundedAmount,
    );
    if (amount > roundDecimal(refundableAmount + 0.01)) {
      throw new BadRequestException('退款金额超过可退余额');
    }

    const refundDate = dto.refundDate
      ? this.parseTrialBalanceDate(dto.refundDate, 'startDate')
      : new Date();
    const refund = await this.prisma.customerRefund.create({
      data: {
        refundNo: `RF-${Date.now()}`,
        creditNoteId: creditNote.id,
        partnerId: creditNote.partnerId,
        amount,
        method: dto.method,
        status: 'DRAFT',
        postingStatus: EntryPostingStatus.DRAFT,
        refundDate,
        note: dto.note ?? null,
        companyId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'CREATE_CUSTOMER_REFUND',
        entity: 'CustomerRefund',
        entityId: refund.id,
        details: {
          refundNo: refund.refundNo,
          creditNoteId: creditNote.id,
          amount,
          method: dto.method,
        },
        companyId,
      },
    });

    return refund;
  }

  async getCustomerRefunds(companyId: string, pagination: PaginationDto) {
    return this.financeQueryService.getCustomerRefunds(companyId, pagination);
  }

  async postCustomerRefund(
    companyId: string,
    refundId: string,
    operatorId: string,
  ) {
    const refund = await this.prisma.customerRefund.findFirst({
      where: { id: refundId, companyId },
      include: {
        creditNote: {
          include: {
            refunds: {
              where: {
                postingStatus: EntryPostingStatus.POSTED,
                id: { not: refundId },
              },
              select: { amount: true, postingStatus: true },
            },
          },
        },
      },
    });
    if (!refund) {
      throw new NotFoundException('客户退款单不存在');
    }
    if (refund.postingStatus === EntryPostingStatus.POSTED) {
      return {
        refundId: refund.id,
        refundNo: refund.refundNo,
        postingStatus: refund.postingStatus,
        message: '客户退款单已过账，无需重复处理',
      };
    }
    if (refund.creditNote.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('贷项凭证尚未过账，不能退款');
    }
    await this.assertAccountingPeriodOpen(companyId, refund.refundDate);

    const refundedAmount = this.postedRefundAmount(refund.creditNote.refunds);
    const refundableAmount = roundDecimal(
      Number(refund.creditNote.refundLiabilityAmount) - refundedAmount,
    );
    const amount = roundDecimal(Number(refund.amount));
    if (amount > roundDecimal(refundableAmount + 0.01)) {
      throw new BadRequestException('退款金额超过可退余额');
    }

    const posted = await this.prisma.customerRefund.update({
      where: { id: refund.id },
      data: {
        status: 'POSTED',
        postingStatus: EntryPostingStatus.POSTED,
        postedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_CUSTOMER_REFUND',
        entity: 'CustomerRefund',
        entityId: refund.id,
        details: {
          refundNo: refund.refundNo,
          creditNoteId: refund.creditNoteId,
          amount,
          method: refund.method,
        },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.customer_refund.posted', {
      companyId,
      idempotencyKey: `customer_refund_posted:${refund.id}`,
      refundId: refund.id,
      operatorId,
    });

    return posted;
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
    await this.assertAccountingPeriodOpen(companyId, invoice.issuedDate);

    const resolvedTaxCode = await this.resolveTaxCode(
      companyId,
      taxCodeId ?? invoice.taxCodeId ?? invoice.order?.taxCodeId,
    );
    const amount = roundDecimal(Number(invoice.amount));
    let subTotal = roundDecimal(Number(invoice.subTotal ?? 0));
    let taxAmount = roundDecimal(Number(invoice.taxAmount ?? 0));
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
    return this.financeReportsService.getTrialBalance(
      companyId,
      startDate,
      endDate,
    );
  }

  async getGeneralLedger(
    companyId: string,
    startDate?: string,
    endDate?: string,
    accountCode?: string,
  ): Promise<GeneralLedgerResult> {
    return this.financeReportsService.getGeneralLedger(
      companyId,
      startDate,
      endDate,
      accountCode,
    );
  }

  async getIncomeStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<IncomeStatementResult> {
    return this.financeReportsService.getIncomeStatement(
      companyId,
      startDate,
      endDate,
    );
  }

  async getBalanceSheet(
    companyId: string,
    asOfDate?: string,
  ): Promise<BalanceSheetResult> {
    return this.financeReportsService.getBalanceSheet(companyId, asOfDate);
  }

  async getCashFlowStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<CashFlowResult> {
    return this.financeReportsService.getCashFlowStatement(
      companyId,
      startDate,
      endDate,
    );
  }

  async getInventoryValuationReconciliation(
    companyId: string,
  ): Promise<InventoryValuationReconciliationResult> {
    const inventoryAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        companyId,
        'INVENTORY',
      );

    const inventoryEventNames = [
      'inventory.stock_depleted',
      'purchase.invoice.posted',
      'purchase.supplier_credit_note.posted',
    ];

    const [
      materialCosts,
      glLines,
      recentGeneralLedgerLines,
      pendingEvents,
      unpostedPurchaseInvoices,
    ] = await Promise.all([
      this.prisma.materialCost.findMany({
        where: { companyId },
        include: {
          material: {
            select: { id: true, sku: true, name: true },
          },
        },
        orderBy: [{ material: { sku: 'asc' } }],
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          account: {
            companyId,
            code: inventoryAccount.accountCode,
            isActive: true,
          },
          journalEntry: {
            companyId,
            postingStatus: EntryPostingStatus.POSTED,
          },
        },
        select: {
          debit: true,
          credit: true,
        },
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          account: {
            companyId,
            code: inventoryAccount.accountCode,
            isActive: true,
          },
          journalEntry: {
            companyId,
            postingStatus: EntryPostingStatus.POSTED,
          },
        },
        select: {
          journalEntryId: true,
          debit: true,
          credit: true,
          memo: true,
          journalEntry: {
            select: {
              entryNo: true,
              date: true,
              ref: true,
              description: true,
            },
          },
        },
        orderBy: [{ journalEntry: { date: 'desc' } }, { lineNo: 'asc' }],
        take: 20,
      }),
      this.prisma.eventDlq.findMany({
        where: {
          companyId,
          eventName: { in: inventoryEventNames },
          status: { in: ['PENDING', 'RETRYING', 'FAILED'] },
        },
        select: {
          id: true,
          eventName: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          nextRetryAt: true,
          updatedAt: true,
          error: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
      }),
      this.prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.DRAFT,
        },
        select: {
          id: true,
          invoiceNo: true,
          purchaseOrderId: true,
          amount: true,
          issuedDate: true,
          postingStatus: true,
          subTotal: true,
          taxAmount: true,
          purchaseOrder: {
            select: {
              purchaseNo: true,
              items: {
                select: {
                  quantity: true,
                  receivedQty: true,
                  unitPrice: true,
                },
              },
              invoices: {
                select: {
                  amount: true,
                  subTotal: true,
                  taxAmount: true,
                },
              },
            },
          },
          supplier: {
            select: { name: true },
          },
        },
        orderBy: [{ issuedDate: 'desc' }],
        take: 10,
      }),
    ]);

    const rows = materialCosts
      .filter(
        (cost) =>
          Number(cost.quantityOnHand ?? 0) !== 0 ||
          Number(cost.inventoryValue ?? 0) !== 0,
      )
      .map((cost) => ({
        materialId: cost.materialId,
        sku: cost.material.sku,
        name: cost.material.name,
        quantityOnHand: roundDecimal(Number(cost.quantityOnHand ?? 0)),
        averageCost: roundDecimal(Number(cost.averageCost ?? 0)),
        inventoryValue: roundDecimal(Number(cost.inventoryValue ?? 0)),
      }));
    const inventoryValue = roundDecimal(
      rows.reduce((sum, row) => sum + row.inventoryValue, 0),
    );
    const generalLedgerBalance = roundDecimal(
      glLines.reduce(
        (sum, line) => sum + Number(line.debit ?? 0) - Number(line.credit ?? 0),
        0,
      ),
    );
    const difference = roundDecimal(inventoryValue - generalLedgerBalance);

    return {
      asOfDate: new Date().toISOString(),
      inventoryAccount: {
        code: inventoryAccount.accountCode,
        name: inventoryAccount.accountName,
        type: inventoryAccount.accountType,
      },
      inventoryValue,
      generalLedgerBalance,
      difference,
      reconciled: Math.abs(difference) < 0.01,
      materialCount: rows.length,
      rows,
      diagnostics: {
        recentGeneralLedgerLines: recentGeneralLedgerLines.map((line) => {
          const debit = roundDecimal(Number(line.debit ?? 0));
          const credit = roundDecimal(Number(line.credit ?? 0));
          return {
            journalEntryId: line.journalEntryId,
            entryNo: line.journalEntry.entryNo,
            date: line.journalEntry.date.toISOString(),
            ref: line.journalEntry.ref,
            description: line.journalEntry.description,
            memo: line.memo,
            debit,
            credit,
            balance: roundDecimal(debit - credit),
          };
        }),
        pendingEvents: pendingEvents.map((event) => ({
          id: event.id,
          eventName: event.eventName,
          status: event.status,
          attempts: event.attempts,
          maxAttempts: event.maxAttempts,
          nextRetryAt: event.nextRetryAt?.toISOString() ?? null,
          updatedAt: event.updatedAt.toISOString(),
          error: event.error || null,
        })),
        unpostedPurchaseInvoices: unpostedPurchaseInvoices.map((invoice) => {
          const match = this.buildPayableInvoiceMatchPreview(invoice);
          return {
            id: invoice.id,
            invoiceNo: invoice.invoiceNo,
            purchaseOrderId: invoice.purchaseOrderId,
            purchaseNo: invoice.purchaseOrder.purchaseNo,
            supplierName: invoice.supplier.name,
            issuedDate: invoice.issuedDate.toISOString(),
            amount: roundDecimal(Number(invoice.amount ?? 0)),
            postingStatus: invoice.postingStatus,
            matchStatus: match.status,
            isPostable: match.isPostable,
            matchReasons: match.reasons,
            amountVariance: match.amountVariance,
          };
        }),
      },
    };
  }

  private buildPayableInvoiceMatchPreview(invoice: {
    amount: Prisma.Decimal | number | string;
    subTotal: Prisma.Decimal | number | string;
    taxAmount: Prisma.Decimal | number | string;
    purchaseOrder: {
      items?: Array<{
        quantity: Prisma.Decimal | number | string;
        receivedQty: Prisma.Decimal | number | string;
        unitPrice: Prisma.Decimal | number | string;
      }>;
      invoices?: Array<{
        amount: Prisma.Decimal | number | string;
        subTotal: Prisma.Decimal | number | string;
        taxAmount: Prisma.Decimal | number | string;
      }>;
    };
  }) {
    const tolerance = 0.01;
    const items = invoice.purchaseOrder.items ?? [];
    const orderedAmount = roundDecimal(
      items.reduce(
        (sum, item) =>
          sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0),
        0,
      ),
    );
    const receivedAmount = roundDecimal(
      items.reduce(
        (sum, item) =>
          sum + Number(item.receivedQty ?? 0) * Number(item.unitPrice ?? 0),
        0,
      ),
    );
    const hasOverReceipt = items.some(
      (item) =>
        Number(item.receivedQty ?? 0) - Number(item.quantity ?? 0) > tolerance,
    );
    const hasPartialReceipt = items.some(
      (item) =>
        Number(item.receivedQty ?? 0) - Number(item.quantity ?? 0) < -tolerance,
    );
    const invoices = invoice.purchaseOrder.invoices?.length
      ? invoice.purchaseOrder.invoices
      : [invoice];
    const invoicedAmount = roundDecimal(
      invoices.reduce((sum, payableInvoice) => {
        const subTotal = Number(payableInvoice.subTotal ?? 0);
        const fallbackAmount =
          Number(payableInvoice.amount ?? 0) -
          Number(payableInvoice.taxAmount ?? 0);
        return sum + (subTotal > 0 ? subTotal : fallbackAmount);
      }, 0),
    );
    const amountVariance = roundDecimal(invoicedAmount - receivedAmount);
    const reasons: string[] = [];

    if (hasOverReceipt) {
      reasons.push('存在超收明细');
    }
    if (hasPartialReceipt) {
      reasons.push('存在未收足明细');
    }
    if (Math.abs(amountVariance) > tolerance) {
      reasons.push(`采购价差 ${amountVariance.toFixed(2)} 将自动入账`);
    }

    const status: InventoryValuationPayableMatchStatus = hasOverReceipt
      ? 'OVER_RECEIPT'
      : hasPartialReceipt
        ? 'PARTIAL_RECEIPT'
        : Math.abs(amountVariance) > tolerance
          ? 'PRICE_VARIANCE'
          : 'MATCHED';

    return {
      status,
      isPostable: !hasOverReceipt && !hasPartialReceipt,
      orderedAmount,
      receivedAmount,
      invoicedAmount,
      amountVariance,
      reasons,
    };
  }

  async getReceivableAging(
    companyId: string,
    asOfDate?: string,
  ): Promise<ReceivableAgingResult> {
    const parsedAsOfDate = this.parseAsOfDate(asOfDate);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        postingStatus: EntryPostingStatus.POSTED,
        status: { not: 'PAID' },
      },
      include: {
        paymentAllocations: true,
        creditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
        order: {
          select: {
            orderNo: true,
            partner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { issuedDate: 'asc' }],
    });

    const totals = {
      totalOpen: 0,
      current: 0,
      days1To30: 0,
      days31To60: 0,
      days61To90: 0,
      days90Plus: 0,
    };
    const rows: ReceivableAgingRow[] = [];

    for (const invoice of invoices) {
      const amount = roundDecimal(Number(invoice.amount));
      const paidAmount = this.paidAmount(invoice.paymentAllocations);
      const creditedAmount = this.postedCreditAmount(invoice.creditNotes);
      const openAmount = roundDecimal(amount - paidAmount - creditedAmount);
      if (openAmount <= 0) continue;

      const dueDate = invoice.dueDate ?? null;
      const daysOverdue = dueDate
        ? Math.max(
            0,
            Math.floor(
              (parsedAsOfDate.getTime() - dueDate.getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : 0;
      const bucket = this.receivableBucket(daysOverdue, dueDate);

      totals.totalOpen = roundDecimal(totals.totalOpen + openAmount);
      if (bucket === 'CURRENT')
        totals.current = roundDecimal(totals.current + openAmount);
      if (bucket === 'DAYS_1_30')
        totals.days1To30 = roundDecimal(totals.days1To30 + openAmount);
      if (bucket === 'DAYS_31_60')
        totals.days31To60 = roundDecimal(totals.days31To60 + openAmount);
      if (bucket === 'DAYS_61_90')
        totals.days61To90 = roundDecimal(totals.days61To90 + openAmount);
      if (bucket === 'DAYS_90_PLUS')
        totals.days90Plus = roundDecimal(totals.days90Plus + openAmount);

      rows.push({
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        orderNo: invoice.order?.orderNo ?? null,
        partnerId: invoice.order?.partner?.id ?? null,
        partnerName: invoice.order?.partner?.name ?? null,
        issuedDate: invoice.issuedDate.toISOString(),
        dueDate: dueDate?.toISOString() ?? null,
        daysOverdue,
        amount,
        paidAmount,
        creditedAmount,
        openAmount,
        bucket,
      });
    }

    return {
      asOfDate: parsedAsOfDate.toISOString(),
      ...totals,
      rows,
    };
  }

  private receivableBucket(
    daysOverdue: number,
    dueDate: Date | null,
  ): ReceivableAgingRow['bucket'] {
    if (!dueDate || daysOverdue <= 0) return 'CURRENT';
    if (daysOverdue <= 30) return 'DAYS_1_30';
    if (daysOverdue <= 60) return 'DAYS_31_60';
    if (daysOverdue <= 90) return 'DAYS_61_90';
    return 'DAYS_90_PLUS';
  }
}
