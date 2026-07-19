import { BadRequestException, Injectable } from '@nestjs/common';
import { EntryPostingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  purchaseMoney,
  purchaseInvoiceOpenAmount,
  postedSupplierCreditAmount,
  postedSupplierPaymentAmount,
  parseStatementDate,
} from './purchase-utils';

export interface SupplierOption {
  id: string;
  code: string | null;
  name: string;
  type: string;
}

export interface SupplierStatementLine {
  sourceType: 'PURCHASE_INVOICE' | 'SUPPLIER_PAYMENT' | 'SUPPLIER_CREDIT_NOTE';
  sourceId: string;
  documentNo: string;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface SupplierStatementPartner {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: SupplierStatementLine[];
}

export interface SupplierStatementResult {
  startDate: string | null;
  endDate: string;
  supplierId: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  suppliers: SupplierStatementPartner[];
}

@Injectable()
export class SupplierStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async listSupplierOptions(companyId: string): Promise<SupplierOption[]> {
    return this.prisma.partner.findMany({
      where: {
        companyId,
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
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

  async getSupplierStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
    supplierId?: string,
  ): Promise<SupplierStatementResult> {
    const parsedStartDate = parseStatementDate(startDate, 'startDate');
    const parsedEndDate = parseStatementDate(endDate, 'endDate') ?? new Date();

    if (
      parsedStartDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const normalizedSupplierId = supplierId?.trim() || undefined;
    if (normalizedSupplierId) {
      const supplier = await this.prisma.partner.findFirst({
        where: {
          id: normalizedSupplierId,
          companyId,
          isActive: true,
          type: { in: ['SUPPLIER', 'BOTH'] },
        },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('供应商不存在或已停用');
      }
    }

    const [invoices, payments, creditNotes] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          issuedDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
          purchaseOrder: { select: { purchaseNo: true } },
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          paymentDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
        },
      }),
      this.prisma.supplierCreditNote.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          creditDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
          purchaseInvoice: { select: { invoiceNo: true } },
        },
      }),
    ]);

    type DraftLine = Omit<SupplierStatementLine, 'runningBalance'> & {
      supplierId: string;
      supplierCode: string | null;
      supplierName: string;
      occurredAt: Date;
    };

    const draftLines: DraftLine[] = [
      ...invoices.map((invoice) => ({
        supplierId: invoice.supplier.id,
        supplierCode: invoice.supplier.code,
        supplierName: invoice.supplier.name,
        sourceType: 'PURCHASE_INVOICE' as const,
        sourceId: invoice.id,
        documentNo: invoice.invoiceNo,
        occurredAt: invoice.issuedDate,
        date: invoice.issuedDate.toISOString(),
        description: invoice.purchaseOrder.purchaseNo
          ? `应付发票 / ${invoice.purchaseOrder.purchaseNo}`
          : '应付发票',
        debit: purchaseMoney(invoice.amount ?? 0).toNumber(),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        supplierId: payment.supplier.id,
        supplierCode: payment.supplier.code,
        supplierName: payment.supplier.name,
        sourceType: 'SUPPLIER_PAYMENT' as const,
        sourceId: payment.id,
        documentNo: payment.paymentNo,
        occurredAt: payment.paymentDate,
        date: payment.paymentDate.toISOString(),
        description: payment.note
          ? `供应商付款 / ${payment.method} / ${payment.note}`
          : `供应商付款 / ${payment.method}`,
        debit: 0,
        credit: purchaseMoney(payment.amount ?? 0).toNumber(),
      })),
      ...creditNotes.map((creditNote) => ({
        supplierId: creditNote.supplier.id,
        supplierCode: creditNote.supplier.code,
        supplierName: creditNote.supplier.name,
        sourceType: 'SUPPLIER_CREDIT_NOTE' as const,
        sourceId: creditNote.id,
        documentNo: creditNote.creditNo,
        occurredAt: creditNote.creditDate,
        date: creditNote.creditDate.toISOString(),
        description: creditNote.purchaseInvoice.invoiceNo
          ? `供应商扣款 / ${creditNote.purchaseInvoice.invoiceNo}`
          : '供应商扣款',
        debit: 0,
        credit: purchaseMoney(creditNote.amount ?? 0).toNumber(),
      })),
    ].sort(
      (a, b) =>
        a.supplierName.localeCompare(b.supplierName) ||
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.documentNo.localeCompare(b.documentNo),
    );

    const suppliersById = new Map<string, SupplierStatementPartner>();
    for (const line of draftLines) {
      const supplier = suppliersById.get(line.supplierId) ?? {
        supplierId: line.supplierId,
        supplierCode: line.supplierCode,
        supplierName: line.supplierName,
        openingBalance: 0,
        periodDebit: 0,
        periodCredit: 0,
        endingBalance: 0,
        lines: [],
      };
      suppliersById.set(line.supplierId, supplier);

      const net = purchaseMoney(line.debit).minus(line.credit).toNumber();
      if (
        parsedStartDate &&
        line.occurredAt.getTime() < parsedStartDate.getTime()
      ) {
        supplier.openingBalance = purchaseMoney(
          purchaseMoney(supplier.openingBalance).plus(net),
        ).toNumber();
        supplier.endingBalance = supplier.openingBalance;
        continue;
      }

      supplier.periodDebit = purchaseMoney(
        purchaseMoney(supplier.periodDebit).plus(line.debit),
      ).toNumber();
      supplier.periodCredit = purchaseMoney(
        purchaseMoney(supplier.periodCredit).plus(line.credit),
      ).toNumber();
      supplier.endingBalance = purchaseMoney(
        purchaseMoney(supplier.endingBalance).plus(net),
      ).toNumber();
      supplier.lines.push({
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        documentNo: line.documentNo,
        date: line.date,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        runningBalance: supplier.endingBalance,
      });
    }

    const suppliers = [...suppliersById.values()]
      .map((supplier) => ({
        ...supplier,
        endingBalance: purchaseMoney(
          purchaseMoney(supplier.openingBalance)
            .plus(supplier.periodDebit)
            .minus(supplier.periodCredit),
        ).toNumber(),
      }))
      .filter(
        (supplier) =>
          Math.abs(supplier.openingBalance) >= 0.01 ||
          Math.abs(supplier.periodDebit) >= 0.01 ||
          Math.abs(supplier.periodCredit) >= 0.01 ||
          Math.abs(supplier.endingBalance) >= 0.01,
      )
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate.toISOString(),
      supplierId: normalizedSupplierId ?? null,
      totalOpeningBalance: purchaseMoney(
        suppliers.reduce((sum, supplier) => sum + supplier.openingBalance, 0),
      ).toNumber(),
      totalDebit: purchaseMoney(
        suppliers.reduce((sum, supplier) => sum + supplier.periodDebit, 0),
      ).toNumber(),
      totalCredit: purchaseMoney(
        suppliers.reduce((sum, supplier) => sum + supplier.periodCredit, 0),
      ).toNumber(),
      totalEndingBalance: purchaseMoney(
        suppliers.reduce((sum, supplier) => sum + supplier.endingBalance, 0),
      ).toNumber(),
      suppliers,
    };
  }

  async listOpenPayables(companyId: string) {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        postingStatus: EntryPostingStatus.POSTED,
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, purchaseNo: true } },
        supplierCreditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
        supplierPaymentAllocations: {
          where: {
            supplierPayment: { postingStatus: EntryPostingStatus.POSTED },
          },
          select: { amount: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { issuedDate: 'asc' }],
      take: 500,
    });

    const rows = invoices
      .map((invoice) => {
        const amount = purchaseMoney(invoice.amount);
        const creditedAmount = postedSupplierCreditAmount(
          invoice.supplierCreditNotes,
        );
        const paidAmount = postedSupplierPaymentAmount(
          invoice.supplierPaymentAllocations,
        );
        const openAmount = purchaseInvoiceOpenAmount(invoice);
        const dueDate = invoice.dueDate ?? null;
        const daysOverdue = dueDate
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
              ),
            )
          : 0;

        return {
          purchaseInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          purchaseOrderId: invoice.purchaseOrderId,
          purchaseNo: invoice.purchaseOrder.purchaseNo,
          supplierId: invoice.supplierId,
          supplierName: invoice.supplier.name,
          issuedDate: invoice.issuedDate.toISOString(),
          dueDate: dueDate?.toISOString() ?? null,
          daysOverdue,
          amount: amount.toNumber(),
          creditedAmount: creditedAmount.toNumber(),
          paidAmount: paidAmount.toNumber(),
          openAmount: openAmount.toNumber(),
          status: invoice.status,
        };
      })
      .filter((row) => row.openAmount > 0);

    return { rows };
  }
}
