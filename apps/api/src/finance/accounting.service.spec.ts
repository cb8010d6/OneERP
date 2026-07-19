import Decimal from 'decimal.js';
import { JournalType } from '@prisma/client';
import { AccountingService } from './accounting.service';

function createService() {
  const prisma = {
    material: {
      findFirst: jest.fn(),
    },
    materialCost: {
      findUnique: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
    },
    taxCode: {
      findFirst: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
    },
    purchaseInvoice: {
      findFirst: jest.fn(),
    },
    creditNote: {
      findFirst: jest.fn(),
    },
    customerRefund: {
      findFirst: jest.fn(),
    },
    stockQuant: {
      groupBy: jest.fn(),
    },
    supplierCreditNote: {
      findFirst: jest.fn(),
    },
    supplierPayment: {
      findFirst: jest.fn(),
    },
    journal: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const mappings = {
    resolveLineAccount: jest.fn(),
    ensureDefaultAccounts: jest.fn(),
  };
  return {
    service: new AccountingService(prisma as never, mappings as never),
    prisma,
    mappings,
  };
}

describe('AccountingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts stock depletion with configured COGS and inventory accounts', async () => {
    const { service, prisma, mappings } = createService();
    prisma.material.findFirst.mockResolvedValue({
      name: '钢板',
      unitPrice: new Decimal(12.5),
    });
    prisma.materialCost.findUnique.mockResolvedValue(null);
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) => {
        if (key === 'COGS') {
          return Promise.resolve({
            accountCode: '6401X',
            accountName: '定制主营业务成本',
            accountType: 'EXPENSE',
          });
        }
        return Promise.resolve({
          accountCode: '1405X',
          accountName: '定制库存商品',
          accountType: 'ASSET',
        });
      },
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je1' } as never);

    await service.postStockDepletedEntry({
      companyId: 'c1',
      materialId: 'm1',
      quantity: 2,
      referenceNo: 'SHIP-1',
    });

    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'COGS');
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'INVENTORY');
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalType: JournalType.INVENTORY,
        lines: [
          expect.objectContaining({
            accountCode: '6401X',
            accountName: '定制主营业务成本',
            debit: new Decimal(25),
          }),
          expect.objectContaining({
            accountCode: '1405X',
            accountName: '定制库存商品',
            credit: new Decimal(25),
          }),
        ],
      }),
    );
  });

  it('posts stock depletion with moving average cost when available', async () => {
    const { service, prisma, mappings } = createService();
    prisma.material.findFirst.mockResolvedValue({
      name: '钢板',
      unitPrice: new Decimal(12.5),
    });
    prisma.materialCost.findUnique.mockResolvedValue({
      averageCost: new Decimal(18),
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            COGS: {
              accountCode: '6401X',
              accountName: '定制主营业务成本',
              accountType: 'EXPENSE',
            },
            INVENTORY: {
              accountCode: '1405X',
              accountName: '定制库存商品',
              accountType: 'ASSET',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je-moving-average' } as never);

    await service.postStockDepletedEntry({
      companyId: 'c1',
      materialId: 'm1',
      quantity: 2,
      referenceNo: 'SHIP-2',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            accountCode: '6401X',
            debit: new Decimal(36),
          }),
          expect.objectContaining({
            accountCode: '1405X',
            credit: new Decimal(36),
          }),
        ],
      }),
    );
  });

  it('posts sales invoice with configured receivable, revenue, and tax accounts', async () => {
    const { service, prisma, mappings } = createService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv1',
      invoiceNo: 'INV-1',
      amount: new Decimal(113),
      subTotal: new Decimal(100),
      taxAmount: new Decimal(13),
      order: { orderNo: 'SO-1', partnerId: 'p1' },
      taxCode: null,
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
            SALES_REVENUE: {
              accountCode: '6001X',
              accountName: '定制销售收入',
              accountType: 'REVENUE',
            },
            OUTPUT_TAX: {
              accountCode: '222101X',
              accountName: '定制销项税',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je1' } as never);

    await service.postInvoicePostedEntry({
      companyId: 'c1',
      invoiceId: 'inv1',
      operatorId: 'u1',
    });

    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'RECEIVABLE',
    );
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'SALES_REVENUE',
    );
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'OUTPUT_TAX',
    );
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalType: JournalType.SALES,
        ref: 'INV-1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '1122X',
            debit: new Decimal(113),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '6001X',
            credit: new Decimal(100),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '222101X',
            credit: new Decimal(13),
          }),
        ],
      }),
    );
  });

  it('keeps a tax code account when one is configured on the invoice tax code', async () => {
    const { service, prisma, mappings } = createService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: 'inv1',
      invoiceNo: 'INV-1',
      amount: new Decimal(113),
      subTotal: new Decimal(100),
      taxAmount: new Decimal(13),
      order: { orderNo: 'SO-1', partnerId: 'p1' },
      taxCode: {
        account: {
          code: '222199',
          name: '专用税码科目',
          type: 'LIABILITY',
        },
      },
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
            SALES_REVENUE: {
              accountCode: '6001X',
              accountName: '定制销售收入',
              accountType: 'REVENUE',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je1' } as never);

    await service.postInvoicePostedEntry({
      companyId: 'c1',
      invoiceId: 'inv1',
    });

    expect(mappings.resolveLineAccount).not.toHaveBeenCalledWith(
      'c1',
      'OUTPUT_TAX',
    );
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            accountCode: '1122X',
            debit: new Decimal(113),
          }),
          expect.objectContaining({
            accountCode: '6001X',
            credit: new Decimal(100),
          }),
          expect.objectContaining({
            accountCode: '222199',
            accountName: '专用税码科目',
            credit: new Decimal(13),
          }),
        ],
      }),
    );
  });

  it('posts payable invoice with inventory, input tax, and payable accounts', async () => {
    const { service, prisma, mappings } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi1',
      invoiceNo: 'PI-1',
      amount: new Decimal(113),
      subTotal: new Decimal(100),
      taxAmount: new Decimal(13),
      supplierId: 's1',
      purchaseOrder: {
        purchaseNo: 'PO-1',
        items: [
          {
            materialId: 'm1',
            receivedQty: new Decimal(2),
            unitPrice: new Decimal(50),
          },
        ],
      },
      supplier: { id: 's1', name: '华东供应商' },
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            INVENTORY: {
              accountCode: '1405X',
              accountName: '定制库存商品',
              accountType: 'ASSET',
            },
            INPUT_TAX: {
              accountCode: '222102X',
              accountName: '定制进项税',
              accountType: 'ASSET',
            },
            PAYABLE: {
              accountCode: '2202X',
              accountName: '定制应付账款',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je-pur1' } as never);

    await service.postPurchaseInvoicePostedEntry({
      companyId: 'c1',
      purchaseInvoiceId: 'pi1',
      operatorId: 'u1',
    });

    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'INVENTORY');
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'INPUT_TAX');
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'PAYABLE');
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalCode: 'PUR',
        journalType: JournalType.PURCHASE,
        ref: 'PI-1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '1405X',
            debit: new Decimal(100),
            partnerId: 's1',
          }),
          expect.objectContaining({
            accountCode: '222102X',
            debit: new Decimal(13),
          }),
          expect.objectContaining({
            accountCode: '2202X',
            credit: new Decimal(113),
            partnerId: 's1',
          }),
        ],
      }),
    );
  });

  it('posts payable invoice purchase price variance separately', async () => {
    const { service, prisma, mappings } = createService();
    prisma.purchaseInvoice.findFirst.mockResolvedValue({
      id: 'pi2',
      invoiceNo: 'PI-2',
      amount: new Decimal(126),
      subTotal: new Decimal(110),
      taxAmount: new Decimal(16),
      supplierId: 's1',
      purchaseOrder: {
        purchaseNo: 'PO-2',
        items: [
          {
            materialId: 'm1',
            receivedQty: new Decimal(2),
            unitPrice: new Decimal(50),
          },
        ],
      },
      supplier: { id: 's1', name: '华东供应商' },
    });
    prisma.stockQuant.groupBy.mockResolvedValue([
      { materialId: 'm1', _sum: { quantity: new Decimal(1) } },
    ]);
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            INVENTORY: {
              accountCode: '1405X',
              accountName: '定制库存商品',
              accountType: 'ASSET',
            },
            INPUT_TAX: {
              accountCode: '222102X',
              accountName: '定制进项税',
              accountType: 'ASSET',
            },
            PAYABLE: {
              accountCode: '2202X',
              accountName: '定制应付账款',
              accountType: 'LIABILITY',
            },
            PURCHASE_PRICE_VARIANCE: {
              accountCode: '500101X',
              accountName: '定制采购价差',
              accountType: 'EXPENSE',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je-pur-var' } as never);

    await service.postPurchaseInvoicePostedEntry({
      companyId: 'c1',
      purchaseInvoiceId: 'pi2',
      operatorId: 'u1',
    });

    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'PURCHASE_PRICE_VARIANCE',
    );
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        journalCode: 'PUR',
        ref: 'PI-2',
        lines: [
          expect.objectContaining({
            accountCode: '1405X',
            debit: new Decimal(100),
          }),
          expect.objectContaining({
            accountCode: '1405X',
            debit: new Decimal(5),
          }),
          expect.objectContaining({
            accountCode: '500101X',
            debit: new Decimal(5),
          }),
          expect.objectContaining({
            accountCode: '222102X',
            debit: new Decimal(16),
          }),
          expect.objectContaining({
            accountCode: '2202X',
            credit: new Decimal(126),
          }),
        ],
      }),
    );
  });

  it('posts supplier credit note as payable reduction', async () => {
    const { service, prisma, mappings } = createService();
    prisma.supplierCreditNote.findFirst.mockResolvedValue({
      id: 'scn1',
      creditNo: 'SCN-1',
      amount: new Decimal(50),
      supplierId: 's1',
      supplier: { id: 's1', name: '华东供应商' },
      purchaseInvoice: { invoiceNo: 'PI-1' },
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            PAYABLE: {
              accountCode: '2202X',
              accountName: '定制应付账款',
              accountType: 'LIABILITY',
            },
            INVENTORY: {
              accountCode: '1405X',
              accountName: '定制库存商品',
              accountType: 'ASSET',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je-pur2' } as never);

    await service.postSupplierCreditNotePostedEntry({
      companyId: 'c1',
      supplierCreditNoteId: 'scn1',
      operatorId: 'u1',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        journalCode: 'PUR',
        ref: 'SCN-1',
        lines: [
          expect.objectContaining({
            accountCode: '2202X',
            debit: new Decimal(50),
            partnerId: 's1',
          }),
          expect.objectContaining({
            accountCode: '1405X',
            credit: new Decimal(50),
            partnerId: 's1',
          }),
        ],
      }),
    );
  });

  it('posts supplier payment against payable and payment account', async () => {
    const { service, prisma, mappings } = createService();
    prisma.supplierPayment.findFirst.mockResolvedValue({
      id: 'sp1',
      paymentNo: 'SP-1',
      amount: new Decimal(300),
      method: 'BANK_TRANSFER',
      supplierId: 's1',
      supplier: { id: 's1', name: '华东供应商' },
      allocations: [
        {
          amount: new Decimal(300),
          purchaseInvoice: { invoiceNo: 'PI-1' },
        },
      ],
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            PAYABLE: {
              accountCode: '2202X',
              accountName: '定制应付账款',
              accountType: 'LIABILITY',
            },
            BANK: {
              accountCode: '1002X',
              accountName: '定制银行存款',
              accountType: 'ASSET',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je-pur3' } as never);

    await service.postSupplierPaymentEntry({
      companyId: 'c1',
      supplierPaymentId: 'sp1',
      operatorId: 'u1',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        journalCode: 'BNK',
        ref: 'SUPPAY-sp1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '2202X',
            debit: new Decimal(300),
            partnerId: 's1',
          }),
          expect.objectContaining({
            accountCode: '1002X',
            credit: new Decimal(300),
            partnerId: 's1',
          }),
        ],
      }),
    );
  });

  it('posts received payment against receivables with payment method account', async () => {
    const { service, prisma, mappings } = createService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay1',
      amount: new Decimal(500),
      method: 'ALIPAY',
      partnerId: 'p1',
      partner: { id: 'p1', name: '蓝海科技' },
      invoice: null,
      allocations: [
        {
          amount: new Decimal(500),
          invoice: {
            invoiceNo: 'INV-1',
            order: { orderNo: 'SO-1', partnerId: 'p1' },
          },
        },
      ],
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            ALIPAY: {
              accountCode: '101201X',
              accountName: '定制支付宝',
              accountType: 'ASSET',
            },
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je1' } as never);

    await service.postPaymentReceivedEntry({
      companyId: 'c1',
      paymentId: 'pay1',
      operatorId: 'u1',
    });

    expect(mappings.resolveLineAccount).toHaveBeenCalledWith('c1', 'ALIPAY');
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'RECEIVABLE',
    );
    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalCode: 'BNK',
        journalType: JournalType.BANK,
        ref: 'PAY-pay1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '101201X',
            debit: new Decimal(500),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '1122X',
            credit: new Decimal(500),
            partnerId: 'p1',
          }),
        ],
      }),
    );
  });

  it('posts unapplied payment balance to customer advance account', async () => {
    const { service, prisma, mappings } = createService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay2',
      amount: new Decimal(700),
      method: 'BANK_TRANSFER',
      partnerId: 'p1',
      partner: { id: 'p1', name: '蓝海科技' },
      invoice: null,
      allocations: [
        {
          amount: new Decimal(500),
          invoice: {
            invoiceNo: 'INV-2',
            order: { orderNo: 'SO-2', partnerId: 'p1' },
          },
        },
      ],
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            BANK: {
              accountCode: '1002X',
              accountName: '定制银行存款',
              accountType: 'ASSET',
            },
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
            CUSTOMER_ADVANCE: {
              accountCode: '2203X',
              accountName: '定制预收账款',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je2' } as never);

    await service.postPaymentReceivedEntry({
      companyId: 'c1',
      paymentId: 'pay2',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            accountCode: '1002X',
            debit: new Decimal(700),
          }),
          expect.objectContaining({
            accountCode: '1122X',
            credit: new Decimal(500),
          }),
          expect.objectContaining({
            accountCode: '2203X',
            credit: new Decimal(200),
          }),
        ],
      }),
    );
  });

  it('posts customer advance application against receivables', async () => {
    const { service, prisma, mappings } = createService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay2',
      amount: new Decimal(700),
      method: 'BANK_TRANSFER',
      partnerId: 'p1',
      partner: { id: 'p1', name: '蓝海科技' },
      allocations: [
        {
          id: 'pa1',
          amount: new Decimal(300),
          invoice: {
            invoiceNo: 'INV-3',
            order: { orderNo: 'SO-3', partnerId: 'p1' },
          },
        },
      ],
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            CUSTOMER_ADVANCE: {
              accountCode: '2203X',
              accountName: '定制预收账款',
              accountType: 'LIABILITY',
            },
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je3' } as never);

    await service.postCustomerAdvanceAppliedEntry({
      companyId: 'c1',
      paymentId: 'pay2',
      allocationIds: ['pa1'],
      operatorId: 'u1',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalCode: 'SAL',
        ref: 'PAY-APPLY-pa1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '2203X',
            debit: new Decimal(300),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '1122X',
            credit: new Decimal(300),
            partnerId: 'p1',
          }),
        ],
      }),
    );
  });

  it('posts credit note as a reverse receivable and revenue entry', async () => {
    const { service, prisma, mappings } = createService();
    prisma.creditNote.findFirst.mockResolvedValue({
      id: 'cn1',
      creditNo: 'CN-1',
      amount: new Decimal(113),
      subTotal: new Decimal(100),
      taxAmount: new Decimal(13),
      receivableAppliedAmount: new Decimal(113),
      refundLiabilityAmount: new Decimal(0),
      partnerId: 'p1',
      invoice: {
        invoiceNo: 'INV-1',
        order: { orderNo: 'SO-1', partnerId: 'p1' },
      },
      taxCode: null,
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
            SALES_REVENUE: {
              accountCode: '6001X',
              accountName: '定制销售收入',
              accountType: 'REVENUE',
            },
            OUTPUT_TAX: {
              accountCode: '222101X',
              accountName: '定制销项税',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je4' } as never);

    await service.postCreditNotePostedEntry({
      companyId: 'c1',
      creditNoteId: 'cn1',
      operatorId: 'u1',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        journalCode: 'SAL',
        ref: 'CN-1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '6001X',
            debit: new Decimal(100),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '222101X',
            debit: new Decimal(13),
          }),
          expect.objectContaining({
            accountCode: '1122X',
            credit: new Decimal(113),
            partnerId: 'p1',
          }),
        ],
      }),
    );
  });

  it('posts credit note refund liability when invoice was already paid', async () => {
    const { service, prisma, mappings } = createService();
    prisma.creditNote.findFirst.mockResolvedValue({
      id: 'cn2',
      creditNo: 'CN-2',
      amount: new Decimal(113),
      subTotal: new Decimal(100),
      taxAmount: new Decimal(13),
      receivableAppliedAmount: new Decimal(0),
      refundLiabilityAmount: new Decimal(113),
      partnerId: 'p1',
      invoice: {
        invoiceNo: 'INV-2',
        order: { orderNo: 'SO-2', partnerId: 'p1' },
      },
      taxCode: null,
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            RECEIVABLE: {
              accountCode: '1122X',
              accountName: '定制应收账款',
              accountType: 'ASSET',
            },
            SALES_REVENUE: {
              accountCode: '6001X',
              accountName: '定制销售收入',
              accountType: 'REVENUE',
            },
            OUTPUT_TAX: {
              accountCode: '222101X',
              accountName: '定制销项税',
              accountType: 'LIABILITY',
            },
            CUSTOMER_REFUND_PAYABLE: {
              accountCode: '224102X',
              accountName: '定制应退客户款',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je5' } as never);

    await service.postCreditNotePostedEntry({
      companyId: 'c1',
      creditNoteId: 'cn2',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'CN-2',
        lines: [
          expect.objectContaining({
            accountCode: '6001X',
            debit: new Decimal(100),
          }),
          expect.objectContaining({
            accountCode: '222101X',
            debit: new Decimal(13),
          }),
          expect.objectContaining({
            accountCode: '224102X',
            credit: new Decimal(113),
            partnerId: 'p1',
          }),
        ],
      }),
    );
  });

  it('posts customer refund payment against refund payable', async () => {
    const { service, prisma, mappings } = createService();
    prisma.customerRefund.findFirst.mockResolvedValue({
      id: 'rf1',
      refundNo: 'RF-1',
      amount: new Decimal(80),
      method: 'BANK_TRANSFER',
      partnerId: 'p1',
      partner: { id: 'p1', name: '蓝海科技' },
      creditNote: { creditNo: 'CN-2' },
    });
    mappings.resolveLineAccount.mockImplementation(
      (_companyId: string, key: string) =>
        Promise.resolve(
          {
            BANK: {
              accountCode: '1002X',
              accountName: '定制银行存款',
              accountType: 'ASSET',
            },
            CUSTOMER_REFUND_PAYABLE: {
              accountCode: '224102X',
              accountName: '定制应退客户款',
              accountType: 'LIABILITY',
            },
          }[key],
        ),
    );
    const createBalancedEntry = jest
      .spyOn(service, 'createBalancedEntry')
      .mockResolvedValue({ id: 'je6' } as never);

    await service.postCustomerRefundEntry({
      companyId: 'c1',
      refundId: 'rf1',
      operatorId: 'u1',
    });

    expect(createBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        journalCode: 'BNK',
        ref: 'REFUND-rf1',
        createdBy: 'u1',
        lines: [
          expect.objectContaining({
            accountCode: '224102X',
            debit: new Decimal(80),
            partnerId: 'p1',
          }),
          expect.objectContaining({
            accountCode: '1002X',
            credit: new Decimal(80),
            partnerId: 'p1',
          }),
        ],
      }),
    );
  });
});
