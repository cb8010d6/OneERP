import {
  buildPurchaseMatchSummary,
  withPurchaseMatch,
  purchaseOrderInclude,
} from './purchase-order-read-model';

describe('purchaseOrderInclude', () => {
  it('returns include structure with supplier, items, receipts, invoices', () => {
    const include = purchaseOrderInclude();
    expect(include.supplier).toBe(true);
    expect(include.items).toEqual({ include: { material: true } });
    expect(include.receipts).toBeDefined();
    expect(include.invoices).toBeDefined();
  });
});

describe('buildPurchaseMatchSummary', () => {
  const makeLine = (overrides: Record<string, unknown> = {}) => ({
    id: 'line-1',
    materialId: 'mat-1',
    quantity: 10,
    receivedQty: 10,
    unitPrice: 100,
    material: { name: '钢板', sku: 'STL-001' },
    ...overrides,
  });

  const makeInvoice = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    invoiceNo: 'PI-001',
    amount: 1130,
    subTotal: 1000,
    taxAmount: 130,
    ...overrides,
  });

  it('returns MATCHED when quantities and amounts align', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine()],
      invoices: [makeInvoice()],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.isPostable).toBe(true);
    expect(result.orderedQty).toBe(10);
    expect(result.receivedQty).toBe(10);
    expect(result.quantityVariance).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns NO_INVOICE when no invoices exist', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine()],
      invoices: [],
    });

    expect(result.status).toBe('NO_INVOICE');
    expect(result.isPostable).toBe(false);
    expect(result.reasons).toContain('尚未生成应付发票');
  });

  it('returns PARTIAL_RECEIPT when received < ordered', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine({ receivedQty: 8 })],
      invoices: [makeInvoice()],
    });

    expect(result.status).toBe('PARTIAL_RECEIPT');
    expect(result.isPostable).toBe(false);
    expect(result.reasons).toContain('存在未收足明细');
    expect(result.lines[0].status).toBe('PARTIAL_RECEIPT');
  });

  it('returns OVER_RECEIPT when received > ordered', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine({ receivedQty: 12 })],
      invoices: [makeInvoice()],
    });

    expect(result.status).toBe('OVER_RECEIPT');
    expect(result.isPostable).toBe(false);
    expect(result.reasons).toContain('存在超收明细');
    expect(result.lines[0].status).toBe('OVER_RECEIPT');
  });

  it('returns PRICE_VARIANCE when invoiced amount differs from received', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine()],
      invoices: [makeInvoice({ subTotal: 1100, amount: 1243, taxAmount: 143 })],
    });

    expect(result.status).toBe('PRICE_VARIANCE');
    expect(result.isPostable).toBe(true);
    expect(result.reasons).toContain('采购价差 100.00 将自动入账');
  });

  it('handles empty items gracefully', () => {
    const result = buildPurchaseMatchSummary({
      items: [],
      invoices: [makeInvoice()],
    });

    expect(result.status).toBe('PRICE_VARIANCE');
    expect(result.isPostable).toBe(true);
    expect(result.orderedQty).toBe(0);
    expect(result.receivedQty).toBe(0);
  });

  it('handles undefined items and invoices', () => {
    const result = buildPurchaseMatchSummary({});

    expect(result.status).toBe('NO_INVOICE');
    expect(result.isPostable).toBe(false);
    expect(result.orderedQty).toBe(0);
  });

  it('uses subTotal over amount minus tax for invoiced amount', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine()],
      invoices: [makeInvoice({ subTotal: 1000, amount: 9999, taxAmount: 0 })],
    });

    expect(result.invoicedAmount).toBe(1000);
    expect(result.status).toBe('MATCHED');
  });

  it('falls back to amount minus taxAmount when subTotal is 0', () => {
    const result = buildPurchaseMatchSummary({
      items: [makeLine()],
      invoices: [makeInvoice({ subTotal: 0, amount: 1130, taxAmount: 130 })],
    });

    expect(result.invoicedAmount).toBe(1000);
    expect(result.status).toBe('MATCHED');
  });
});

describe('withPurchaseMatch', () => {
  it('adds purchaseMatch to order object', () => {
    const order = {
      id: 'po-1',
      items: [
        {
          id: 'line-1',
          materialId: 'mat-1',
          quantity: 10,
          receivedQty: 10,
          unitPrice: 100,
          material: null,
        },
      ],
      invoices: [
        {
          id: 'inv-1',
          invoiceNo: 'PI-001',
          amount: 1130,
          subTotal: 1000,
          taxAmount: 130,
        },
      ],
    };

    const result = withPurchaseMatch(order);

    expect(result.id).toBe('po-1');
    expect(result.purchaseMatch).toBeDefined();
    expect(result.purchaseMatch.status).toBe('MATCHED');
  });
});
