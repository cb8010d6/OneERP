import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { purchaseMoney } from './purchase-utils';

export type PurchaseMatchStatus =
  | 'NO_INVOICE'
  | 'PARTIAL_RECEIPT'
  | 'OVER_RECEIPT'
  | 'PRICE_VARIANCE'
  | 'MATCHED';

export type PurchaseOrderForMatch = {
  items?: Array<{
    id: string;
    materialId: string;
    quantity: Prisma.Decimal | Decimal.Value;
    receivedQty: Prisma.Decimal | Decimal.Value;
    unitPrice: Prisma.Decimal | Decimal.Value;
    material?: { name?: string | null; sku?: string | null } | null;
  }>;
  invoices?: Array<{
    id: string;
    invoiceNo: string;
    amount: Prisma.Decimal | Decimal.Value;
    subTotal: Prisma.Decimal | Decimal.Value;
    taxAmount: Prisma.Decimal | Decimal.Value;
  }>;
};

export function purchaseOrderInclude() {
  return {
    supplier: true,
    items: { include: { material: true } },
    receipts: {
      include: { lines: true },
      orderBy: { createdAt: 'desc' as const },
    },
    invoices: {
      include: {
        supplierCreditNotes: true,
        supplierPaymentAllocations: {
          include: { supplierPayment: true },
        },
      },
    },
  };
}

export function withPurchaseMatch<T extends PurchaseOrderForMatch>(order: T) {
  return {
    ...order,
    purchaseMatch: buildPurchaseMatchSummary(order),
  };
}

export function buildPurchaseMatchSummary(order: PurchaseOrderForMatch) {
  const tolerance = new Decimal(0.01);
  const lines = (order.items ?? []).map((line) => {
    const orderedQty = purchaseMoney(line.quantity);
    const receivedQty = purchaseMoney(line.receivedQty);
    const unitPrice = purchaseMoney(line.unitPrice);
    const orderedAmount = purchaseMoney(orderedQty.times(unitPrice));
    const receivedAmount = purchaseMoney(receivedQty.times(unitPrice));
    const quantityVariance = purchaseMoney(receivedQty.minus(orderedQty));
    const amountVariance = purchaseMoney(receivedAmount.minus(orderedAmount));
    const status: PurchaseMatchStatus = quantityVariance.gt(tolerance)
      ? 'OVER_RECEIPT'
      : quantityVariance.lt(tolerance.negated())
        ? 'PARTIAL_RECEIPT'
        : 'MATCHED';

    return {
      purchaseOrderLineId: line.id,
      materialId: line.materialId,
      materialName: line.material?.name ?? null,
      materialSku: line.material?.sku ?? null,
      orderedQty: orderedQty.toNumber(),
      receivedQty: receivedQty.toNumber(),
      quantityVariance: quantityVariance.toNumber(),
      orderedAmount: orderedAmount.toNumber(),
      receivedAmount: receivedAmount.toNumber(),
      amountVariance: amountVariance.toNumber(),
      status,
    };
  });

  const orderedQty = purchaseMoney(
    lines.reduce((sum, line) => sum.plus(line.orderedQty), new Decimal(0)),
  );
  const receivedQty = purchaseMoney(
    lines.reduce((sum, line) => sum.plus(line.receivedQty), new Decimal(0)),
  );
  const orderedAmount = purchaseMoney(
    lines.reduce((sum, line) => sum.plus(line.orderedAmount), new Decimal(0)),
  );
  const receivedAmount = purchaseMoney(
    lines.reduce((sum, line) => sum.plus(line.receivedAmount), new Decimal(0)),
  );
  const invoicedAmount = purchaseMoney(
    (order.invoices ?? []).reduce((sum, invoice) => {
      const subTotal = purchaseMoney(invoice.subTotal ?? 0);
      const fallbackAmount = purchaseMoney(invoice.amount ?? 0).minus(
        invoice.taxAmount ?? 0,
      );
      return sum.plus(subTotal.gt(0) ? subTotal : fallbackAmount);
    }, new Decimal(0)),
  );
  const quantityVariance = purchaseMoney(receivedQty.minus(orderedQty));
  const amountVariance = purchaseMoney(invoicedAmount.minus(receivedAmount));
  const hasInvoice = (order.invoices ?? []).length > 0;
  const reasons: string[] = [];

  if (!hasInvoice) {
    reasons.push('尚未生成应付发票');
  }
  if (lines.some((line) => line.status === 'OVER_RECEIPT')) {
    reasons.push('存在超收明细');
  }
  if (lines.some((line) => line.status === 'PARTIAL_RECEIPT')) {
    reasons.push('存在未收足明细');
  }
  if (hasInvoice && amountVariance.abs().gt(tolerance)) {
    reasons.push(`采购价差 ${amountVariance.toFixed(2)} 将自动入账`);
  }

  const hasBlockingVariance =
    !hasInvoice ||
    lines.some((line) => line.status === 'OVER_RECEIPT') ||
    lines.some((line) => line.status === 'PARTIAL_RECEIPT');
  const status: PurchaseMatchStatus = !hasInvoice
    ? 'NO_INVOICE'
    : lines.some((line) => line.status === 'OVER_RECEIPT')
      ? 'OVER_RECEIPT'
      : lines.some((line) => line.status === 'PARTIAL_RECEIPT')
        ? 'PARTIAL_RECEIPT'
        : amountVariance.abs().gt(tolerance)
          ? 'PRICE_VARIANCE'
          : 'MATCHED';

  return {
    status,
    isPostable: !hasBlockingVariance,
    orderedQty: orderedQty.toNumber(),
    receivedQty: receivedQty.toNumber(),
    quantityVariance: quantityVariance.toNumber(),
    orderedAmount: orderedAmount.toNumber(),
    receivedAmount: receivedAmount.toNumber(),
    invoicedAmount: invoicedAmount.toNumber(),
    amountVariance: amountVariance.toNumber(),
    tolerance: tolerance.toNumber(),
    reasons,
    lines,
  };
}
