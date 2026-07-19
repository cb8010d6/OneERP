import { BadRequestException, Injectable } from '@nestjs/common';
import { EntryPostingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { roundDecimal } from '../core/utils/decimal';

function parseFinanceDate(
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

export interface CustomerOption {
  id: string;
  code: string | null;
  name: string;
  type: string;
}

export interface CustomerStatementLine {
  sourceType: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'REFUND';
  sourceId: string;
  documentNo: string;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface CustomerStatementPartner {
  partnerId: string;
  partnerCode: string | null;
  partnerName: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: CustomerStatementLine[];
}

export interface CustomerStatementResult {
  startDate: string | null;
  endDate: string;
  partnerId: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  partners: CustomerStatementPartner[];
}

@Injectable()
export class CustomerStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomerOptions(companyId: string): Promise<CustomerOption[]> {
    return this.prisma.partner.findMany({
      where: {
        companyId,
        isActive: true,
        type: { in: ['CUSTOMER', 'BOTH'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
      take: 500,
    });
  }

  async getCustomerStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
    partnerId?: string,
  ): Promise<CustomerStatementResult> {
    const parsedStartDate = parseFinanceDate(startDate, 'startDate');
    const parsedEndDate = parseFinanceDate(endDate, 'endDate') ?? new Date();

    if (
      parsedStartDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const normalizedPartnerId = partnerId?.trim() || undefined;
    if (normalizedPartnerId) {
      const partner = await this.prisma.partner.findFirst({
        where: {
          id: normalizedPartnerId,
          companyId,
          isActive: true,
          type: { in: ['CUSTOMER', 'BOTH'] },
        },
        select: { id: true },
      });
      if (!partner) {
        throw new BadRequestException('客户不存在或已停用');
      }
    }

    const [invoices, payments, creditNotes, refunds] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          issuedDate: { lte: parsedEndDate },
          ...(normalizedPartnerId
            ? { order: { partnerId: normalizedPartnerId } }
            : {}),
        },
        include: {
          order: { select: { orderNo: true, partner: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          paymentDate: { lte: parsedEndDate },
          ...(normalizedPartnerId ? { partnerId: normalizedPartnerId } : {}),
        },
        include: {
          partner: true,
        },
      }),
      this.prisma.creditNote.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          creditDate: { lte: parsedEndDate },
          ...(normalizedPartnerId ? { partnerId: normalizedPartnerId } : {}),
        },
        include: {
          partner: true,
          invoice: { select: { invoiceNo: true } },
        },
      }),
      this.prisma.customerRefund.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          refundDate: { lte: parsedEndDate },
          ...(normalizedPartnerId ? { partnerId: normalizedPartnerId } : {}),
        },
        include: {
          partner: true,
          creditNote: { select: { creditNo: true } },
        },
      }),
    ]);

    type DraftLine = Omit<CustomerStatementLine, 'runningBalance'> & {
      partnerId: string;
      partnerCode: string | null;
      partnerName: string;
      occurredAt: Date;
    };

    const draftLines: DraftLine[] = [
      ...invoices.map((invoice) => ({
        partnerId: invoice.order.partner.id,
        partnerCode: invoice.order.partner.code,
        partnerName: invoice.order.partner.name,
        sourceType: 'INVOICE' as const,
        sourceId: invoice.id,
        documentNo: invoice.invoiceNo,
        occurredAt: invoice.issuedDate,
        date: invoice.issuedDate.toISOString(),
        description: invoice.order.orderNo
          ? `销售发票 / ${invoice.order.orderNo}`
          : '销售发票',
        debit: roundDecimal(Number(invoice.amount ?? 0)),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        partnerId: payment.partner.id,
        partnerCode: payment.partner.code,
        partnerName: payment.partner.name,
        sourceType: 'PAYMENT' as const,
        sourceId: payment.id,
        documentNo: payment.id,
        occurredAt: payment.paymentDate,
        date: payment.paymentDate.toISOString(),
        description: `客户收款 / ${payment.method}`,
        debit: 0,
        credit: roundDecimal(Number(payment.amount ?? 0)),
      })),
      ...creditNotes.map((creditNote) => ({
        partnerId: creditNote.partner.id,
        partnerCode: creditNote.partner.code,
        partnerName: creditNote.partner.name,
        sourceType: 'CREDIT_NOTE' as const,
        sourceId: creditNote.id,
        documentNo: creditNote.creditNo,
        occurredAt: creditNote.creditDate,
        date: creditNote.creditDate.toISOString(),
        description: creditNote.invoice.invoiceNo
          ? `贷项冲减 / ${creditNote.invoice.invoiceNo}`
          : '贷项冲减',
        debit: 0,
        credit: roundDecimal(Number(creditNote.amount ?? 0)),
      })),
      ...refunds.map((refund) => ({
        partnerId: refund.partner.id,
        partnerCode: refund.partner.code,
        partnerName: refund.partner.name,
        sourceType: 'REFUND' as const,
        sourceId: refund.id,
        documentNo: refund.refundNo,
        occurredAt: refund.refundDate,
        date: refund.refundDate.toISOString(),
        description: refund.creditNote.creditNo
          ? `客户退款 / ${refund.creditNote.creditNo}`
          : '客户退款',
        debit: roundDecimal(Number(refund.amount ?? 0)),
        credit: 0,
      })),
    ].sort(
      (a, b) =>
        a.partnerName.localeCompare(b.partnerName) ||
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.documentNo.localeCompare(b.documentNo),
    );

    const partnersById = new Map<string, CustomerStatementPartner>();
    for (const line of draftLines) {
      const partner = partnersById.get(line.partnerId) ?? {
        partnerId: line.partnerId,
        partnerCode: line.partnerCode,
        partnerName: line.partnerName,
        openingBalance: 0,
        periodDebit: 0,
        periodCredit: 0,
        endingBalance: 0,
        lines: [],
      };
      partnersById.set(line.partnerId, partner);

      const net = roundDecimal(line.debit - line.credit);
      if (
        parsedStartDate &&
        line.occurredAt.getTime() < parsedStartDate.getTime()
      ) {
        partner.openingBalance = roundDecimal(partner.openingBalance + net);
        partner.endingBalance = partner.openingBalance;
        continue;
      }

      partner.periodDebit = roundDecimal(partner.periodDebit + line.debit);
      partner.periodCredit = roundDecimal(partner.periodCredit + line.credit);
      partner.endingBalance = roundDecimal(partner.endingBalance + net);
      partner.lines.push({
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        documentNo: line.documentNo,
        date: line.date,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        runningBalance: partner.endingBalance,
      });
    }

    const partners = [...partnersById.values()]
      .map((partner) => ({
        ...partner,
        endingBalance: roundDecimal(
          partner.openingBalance + partner.periodDebit - partner.periodCredit,
        ),
      }))
      .filter(
        (partner) =>
          Math.abs(partner.openingBalance) >= 0.01 ||
          Math.abs(partner.periodDebit) >= 0.01 ||
          Math.abs(partner.periodCredit) >= 0.01 ||
          Math.abs(partner.endingBalance) >= 0.01,
      )
      .sort((a, b) => a.partnerName.localeCompare(b.partnerName));

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate.toISOString(),
      partnerId: normalizedPartnerId ?? null,
      totalOpeningBalance: roundDecimal(
        partners.reduce((sum, partner) => sum + partner.openingBalance, 0),
      ),
      totalDebit: roundDecimal(
        partners.reduce((sum, partner) => sum + partner.periodDebit, 0),
      ),
      totalCredit: roundDecimal(
        partners.reduce((sum, partner) => sum + partner.periodCredit, 0),
      ),
      totalEndingBalance: roundDecimal(
        partners.reduce((sum, partner) => sum + partner.endingBalance, 0),
      ),
      partners,
    };
  }
}
