import { BadRequestException } from '@nestjs/common';
import { EntryPostingStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { roundDecimal } from '../core/utils/decimal';

export function purchaseMoney(value: Decimal.Value) {
  return new Decimal(roundDecimal(value));
}

export function postedSupplierCreditAmount(
  creditNotes?: Array<{
    amount: Prisma.Decimal | Decimal.Value;
    postingStatus?: EntryPostingStatus;
  }>,
) {
  return (creditNotes ?? [])
    .filter((creditNote) => creditNote.postingStatus === 'POSTED')
    .reduce((sum, creditNote) => sum.plus(creditNote.amount), new Decimal(0));
}

export function postedSupplierPaymentAmount(
  allocations?: Array<{
    amount: Prisma.Decimal | Decimal.Value;
    supplierPayment?: { postingStatus?: EntryPostingStatus };
  }>,
) {
  return (allocations ?? [])
    .filter(
      (allocation) =>
        !allocation.supplierPayment ||
        allocation.supplierPayment.postingStatus === 'POSTED',
    )
    .reduce((sum, allocation) => sum.plus(allocation.amount), new Decimal(0));
}

export function purchaseInvoiceOpenAmount(invoice: {
  amount: Prisma.Decimal | Decimal.Value;
  supplierCreditNotes?: Array<{
    amount: Prisma.Decimal | Decimal.Value;
    postingStatus?: EntryPostingStatus;
  }>;
  supplierPaymentAllocations?: Array<{
    amount: Prisma.Decimal | Decimal.Value;
    supplierPayment?: { postingStatus?: EntryPostingStatus };
  }>;
}) {
  const invoiceAmount = purchaseMoney(invoice.amount);
  const credited = postedSupplierCreditAmount(invoice.supplierCreditNotes);
  const paid = postedSupplierPaymentAmount(invoice.supplierPaymentAllocations);
  return Decimal.max(0, invoiceAmount.minus(credited).minus(paid));
}

export function supplierSettlementStatus(
  invoiceAmount: Decimal,
  settled: Decimal,
) {
  if (settled.gte(invoiceAmount.minus(0.01))) return 'PAID';
  if (settled.gt(0)) return 'PARTIAL';
  return 'UNPAID';
}

export function parseStatementDate(
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
