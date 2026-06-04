import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { EntryPostingStatus, JournalType, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { roundDecimal } from '../core/utils/decimal';
import {
  FinanceAccountMappingKey,
  FinanceAccountMappingService,
} from './finance-account-mapping.service';
import { AccountingPeriodService } from './accounting-period.service';

interface JournalLineInput {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit?: Decimal.Value;
  credit?: Decimal.Value;
  partnerId?: string;
  memo?: string;
}

interface CreateBalancedEntryInput {
  companyId: string;
  journalCode: string;
  journalName: string;
  journalType: JournalType;
  date?: Date;
  ref?: string;
  description?: string;
  createdBy?: string;
  lines: JournalLineInput[];
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeAccountMappingService: FinanceAccountMappingService,
    @Optional()
    private readonly accountingPeriodService?: AccountingPeriodService,
  ) {}

  async postStockDepletedEntry(payload: {
    companyId: string;
    referenceNo?: string;
    materialId: string;
    quantity: number;
    unitCost?: number;
    operatorId?: string;
  }) {
    const material = await this.prisma.material.findFirst({
      where: { id: payload.materialId },
      select: { name: true, unitPrice: true },
    });
    const materialCost = await this.prisma.materialCost.findUnique({
      where: {
        companyId_materialId: {
          companyId: payload.companyId,
          materialId: payload.materialId,
        },
      },
      select: { averageCost: true },
    });

    const unitCost = new Decimal(
      payload.unitCost ?? materialCost?.averageCost ?? material?.unitPrice ?? 0,
    );
    const amount = this.money(unitCost.times(payload.quantity ?? 0));
    if (amount.lte(0)) {
      this.logger.warn(
        `跳过零成本库存出库凭证: material=${payload.materialId}`,
      );
      return null;
    }
    const cogsAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'COGS',
      );
    const inventoryAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'INVENTORY',
      );

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'INV',
      journalName: 'Inventory Journal',
      journalType: JournalType.INVENTORY,
      ref: payload.referenceNo,
      description: `库存出库自动凭证: ${material?.name ?? payload.materialId}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...cogsAccount,
          debit: amount,
          memo: '库存出库结转成本',
        },
        {
          ...inventoryAccount,
          credit: amount,
          memo: '库存出库结转成本',
        },
      ],
    });
  }

  async postInvoicePostedEntry(payload: {
    companyId: string;
    invoiceId: string;
    taxCodeId?: string | null;
    taxRate?: number;
    operatorId?: string;
  }) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: payload.invoiceId, companyId: payload.companyId },
      include: {
        order: { select: { orderNo: true, partnerId: true } },
        taxCode: { include: { account: true } },
      },
    });

    if (!invoice) {
      throw new BadRequestException('发票不存在，无法生成凭证');
    }

    const amount = this.money(invoice.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('发票金额必须大于0');
    }

    let revenue = this.money(invoice.subTotal ?? 0);
    let tax = this.money(invoice.taxAmount ?? 0);

    if (revenue.lte(0) && tax.lte(0)) {
      const fallbackRate = Decimal.min(
        Decimal.max(
          new Decimal(payload.taxRate ?? invoice.taxCode?.rate ?? 0.13),
          0,
        ),
        1,
      );
      revenue = this.money(amount.div(new Decimal(1).plus(fallbackRate)));
      tax = this.money(amount.minus(revenue));
      this.logger.warn(
        `发票未包含税额快照，使用兜底税率计算: invoice=${invoice.invoiceNo}`,
      );
    }

    const resolvedTaxCode = invoice.taxCode
      ? invoice.taxCode
      : payload.taxCodeId
        ? await this.prisma.taxCode.findFirst({
            where: {
              id: payload.taxCodeId,
              companyId: payload.companyId,
              active: true,
            },
            include: { account: true },
          })
        : null;

    const taxAccount = resolvedTaxCode?.account;
    if (!taxAccount) {
      this.logger.warn(
        `未配置税码会计科目，使用默认销项税科目: invoice=${invoice.invoiceNo}`,
      );
    }
    const receivableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'RECEIVABLE',
      );
    const revenueAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'SALES_REVENUE',
      );
    const outputTaxAccount = taxAccount
      ? {
          accountCode: taxAccount.code,
          accountName: taxAccount.name,
          accountType: taxAccount.type,
        }
      : await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'OUTPUT_TAX',
        );

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'SAL',
      journalName: 'Sales Journal',
      journalType: JournalType.SALES,
      ref: invoice.invoiceNo,
      description: `销售开票自动凭证: ${invoice.invoiceNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...receivableAccount,
          debit: amount,
          partnerId: invoice.order.partnerId,
          memo: `应收 ${invoice.invoiceNo}`,
        },
        {
          ...revenueAccount,
          credit: revenue,
          partnerId: invoice.order.partnerId,
          memo: `收入 ${invoice.invoiceNo}`,
        },
        {
          ...outputTaxAccount,
          credit: tax,
          memo: `销项税 ${invoice.invoiceNo}`,
        },
      ],
    });
  }

  async postPurchaseInvoicePostedEntry(payload: {
    companyId: string;
    purchaseInvoiceId: string;
    operatorId?: string;
  }) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: {
        id: payload.purchaseInvoiceId,
        companyId: payload.companyId,
      },
      include: {
        purchaseOrder: {
          select: {
            purchaseNo: true,
            items: {
              select: {
                materialId: true,
                receivedQty: true,
                unitPrice: true,
              },
            },
          },
        },
        supplier: { select: { id: true, name: true } },
      },
    });

    if (!invoice) {
      throw new BadRequestException('应付发票不存在，无法生成凭证');
    }

    const amount = this.money(invoice.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('应付发票金额必须大于0');
    }

    let goods = this.money(invoice.subTotal ?? 0);
    const tax = this.money(invoice.taxAmount ?? 0);
    if (goods.lte(0) && tax.lte(0)) {
      goods = amount;
    }
    if (!goods.plus(tax).eq(amount)) {
      goods = this.money(amount.minus(tax));
    }
    const receivedCost = this.money(
      invoice.purchaseOrder.items.reduce(
        (sum, line) =>
          sum.plus(new Decimal(line.receivedQty).times(line.unitPrice)),
        new Decimal(0),
      ),
    );
    const inventoryAmount = receivedCost.gt(0) ? receivedCost : goods;
    const priceVariance = this.money(goods.minus(inventoryAmount));
    const priceVarianceSplit = priceVariance.eq(0)
      ? { inventory: new Decimal(0), expense: new Decimal(0) }
      : await this.splitPurchasePriceVariance({
          companyId: payload.companyId,
          lines: invoice.purchaseOrder.items,
          totalVariance: priceVariance,
          receivedCost,
        });

    const payableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'PAYABLE',
      );
    const inventoryAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'INVENTORY',
      );
    const inputTaxAccount = tax.gt(0)
      ? await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'INPUT_TAX',
        )
      : null;
    const priceVarianceAccount = priceVarianceSplit.expense.eq(0)
      ? null
      : await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'PURCHASE_PRICE_VARIANCE',
        );
    const inventoryVarianceLine = priceVarianceSplit.inventory.eq(0)
      ? []
      : [
          priceVarianceSplit.inventory.gt(0)
            ? {
                ...inventoryAccount,
                debit: priceVarianceSplit.inventory,
                partnerId: invoice.supplierId,
                memo: `在库采购价差 ${invoice.invoiceNo}`,
              }
            : {
                ...inventoryAccount,
                credit: priceVarianceSplit.inventory.abs(),
                partnerId: invoice.supplierId,
                memo: `在库采购价差 ${invoice.invoiceNo}`,
              },
        ];
    const varianceLine = priceVarianceAccount
      ? [
          priceVarianceSplit.expense.gt(0)
            ? {
                ...priceVarianceAccount,
                debit: priceVarianceSplit.expense,
                partnerId: invoice.supplierId,
                memo: `已耗采购价差 ${invoice.invoiceNo}`,
              }
            : {
                ...priceVarianceAccount,
                credit: priceVarianceSplit.expense.abs(),
                partnerId: invoice.supplierId,
                memo: `已耗采购价差 ${invoice.invoiceNo}`,
              },
        ]
      : [];

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'PUR',
      journalName: 'Purchase Journal',
      journalType: JournalType.PURCHASE,
      ref: invoice.invoiceNo,
      description: `应付发票自动凭证: ${invoice.invoiceNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...inventoryAccount,
          debit: inventoryAmount,
          partnerId: invoice.supplierId,
          memo: `采购入账 ${invoice.purchaseOrder.purchaseNo}`,
        },
        ...inventoryVarianceLine,
        ...varianceLine,
        ...(inputTaxAccount
          ? [
              {
                ...inputTaxAccount,
                debit: tax,
                memo: `进项税 ${invoice.invoiceNo}`,
              },
            ]
          : []),
        {
          ...payableAccount,
          credit: amount,
          partnerId: invoice.supplierId,
          memo: `确认应付 ${invoice.supplier.name}`,
        },
      ],
    });
  }

  async postPaymentReceivedEntry(payload: {
    companyId: string;
    paymentId: string;
    operatorId?: string;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: payload.paymentId, companyId: payload.companyId },
      include: {
        partner: { select: { id: true, name: true } },
        invoice: {
          include: { order: { select: { orderNo: true, partnerId: true } } },
        },
        allocations: {
          include: {
            invoice: {
              include: {
                order: { select: { orderNo: true, partnerId: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!payment) {
      throw new BadRequestException('收款记录不存在，无法生成凭证');
    }

    const amount = this.money(payment.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('收款金额必须大于0');
    }

    const cashAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        this.paymentAccountKey(payment.method),
      );
    const receivableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'RECEIVABLE',
      );
    const advanceAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'CUSTOMER_ADVANCE',
      );
    const allocations = payment.allocations.length
      ? payment.allocations
      : payment.invoice
        ? [
            {
              amount: payment.amount,
              invoice: payment.invoice,
            },
          ]
        : [];
    const allocatedAmount = this.money(
      allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Decimal(0),
      ),
    );
    if (allocatedAmount.gt(amount)) {
      throw new BadRequestException('收款核销金额不能超过收款金额');
    }
    const unappliedAmount = this.money(amount.minus(allocatedAmount));

    const journal =
      payment.method === 'CASH'
        ? {
            code: 'CSH',
            name: 'Cash Journal',
            type: JournalType.CASH,
          }
        : {
            code: 'BNK',
            name: 'Bank Journal',
            type: JournalType.BANK,
          };

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: journal.code,
      journalName: journal.name,
      journalType: journal.type,
      ref: `PAY-${payment.id}`,
      description: allocations.length
        ? `收款自动凭证: ${allocations
            .map((allocation) => allocation.invoice.invoiceNo)
            .join(', ')}`
        : `预收款自动凭证: ${payment.partner.name}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...cashAccount,
          debit: amount,
          partnerId: payment.partnerId,
          memo: `收款 ${payment.partner.name}`,
        },
        ...allocations.map((allocation) => ({
          ...receivableAccount,
          credit: this.money(allocation.amount),
          partnerId: allocation.invoice.order.partnerId,
          memo: `冲销应收 ${allocation.invoice.invoiceNo}`,
        })),
        ...(unappliedAmount.gt(0)
          ? [
              {
                ...advanceAccount,
                credit: unappliedAmount,
                partnerId: payment.partnerId,
                memo: `未分配收款 ${payment.partner.name}`,
              },
            ]
          : []),
      ],
    });
  }

  async postCustomerAdvanceAppliedEntry(payload: {
    companyId: string;
    paymentId: string;
    allocationIds: string[];
    operatorId?: string;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: payload.paymentId, companyId: payload.companyId },
      include: {
        partner: { select: { id: true, name: true } },
        allocations: {
          where: { id: { in: payload.allocationIds } },
          include: {
            invoice: {
              include: {
                order: { select: { orderNo: true, partnerId: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (
      !payment ||
      payment.allocations.length !== payload.allocationIds.length
    ) {
      throw new BadRequestException('核销记录不存在，无法生成凭证');
    }

    const total = this.money(
      payment.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Decimal(0),
      ),
    );
    if (total.lte(0)) {
      throw new BadRequestException('核销金额必须大于0');
    }

    const advanceAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'CUSTOMER_ADVANCE',
      );
    const receivableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'RECEIVABLE',
      );

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'SAL',
      journalName: 'Sales Journal',
      journalType: JournalType.SALES,
      ref: `PAY-APPLY-${payload.allocationIds[0]}`,
      description: `预收款核销: ${payment.allocations
        .map((allocation) => allocation.invoice.invoiceNo)
        .join(', ')}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...advanceAccount,
          debit: total,
          partnerId: payment.partnerId,
          memo: `核销预收 ${payment.partner.name}`,
        },
        ...payment.allocations.map((allocation) => ({
          ...receivableAccount,
          credit: this.money(allocation.amount),
          partnerId: allocation.invoice.order.partnerId,
          memo: `冲销应收 ${allocation.invoice.invoiceNo}`,
        })),
      ],
    });
  }

  async postCreditNotePostedEntry(payload: {
    companyId: string;
    creditNoteId: string;
    operatorId?: string;
  }) {
    const creditNote = await this.prisma.creditNote.findFirst({
      where: { id: payload.creditNoteId, companyId: payload.companyId },
      include: {
        invoice: {
          include: {
            order: { select: { orderNo: true, partnerId: true } },
          },
        },
        taxCode: { include: { account: true } },
      },
    });

    if (!creditNote) {
      throw new BadRequestException('贷项凭证不存在，无法生成凭证');
    }

    const amount = this.money(creditNote.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('贷项金额必须大于0');
    }

    const revenue = this.money(creditNote.subTotal ?? 0);
    const tax = this.money(creditNote.taxAmount ?? 0);
    const receivableApplied = this.money(
      creditNote.receivableAppliedAmount ?? 0,
    );
    const refundLiability = this.money(creditNote.refundLiabilityAmount ?? 0);
    const receivableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'RECEIVABLE',
      );
    const revenueAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'SALES_REVENUE',
      );
    const outputTaxAccount = creditNote.taxCode?.account
      ? {
          accountCode: creditNote.taxCode.account.code,
          accountName: creditNote.taxCode.account.name,
          accountType: creditNote.taxCode.account.type,
        }
      : await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'OUTPUT_TAX',
        );
    const refundPayableAccount = refundLiability.gt(0)
      ? await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'CUSTOMER_REFUND_PAYABLE',
        )
      : null;

    const creditLines: JournalLineInput[] = [];
    if (receivableApplied.gt(0)) {
      creditLines.push({
        ...receivableAccount,
        credit: receivableApplied,
        partnerId: creditNote.partnerId,
        memo: `冲减应收 ${creditNote.invoice.invoiceNo}`,
      });
    }
    if (refundLiability.gt(0) && refundPayableAccount) {
      creditLines.push({
        ...refundPayableAccount,
        credit: refundLiability,
        partnerId: creditNote.partnerId,
        memo: `确认应退客户款 ${creditNote.invoice.invoiceNo}`,
      });
    }

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'SAL',
      journalName: 'Sales Journal',
      journalType: JournalType.SALES,
      ref: creditNote.creditNo,
      description: `贷项冲减自动凭证: ${creditNote.creditNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...revenueAccount,
          debit: revenue,
          partnerId: creditNote.partnerId,
          memo: `冲减收入 ${creditNote.invoice.invoiceNo}`,
        },
        {
          ...outputTaxAccount,
          debit: tax,
          memo: `冲减销项税 ${creditNote.invoice.invoiceNo}`,
        },
        ...creditLines,
      ],
    });
  }

  async postCustomerRefundEntry(payload: {
    companyId: string;
    refundId: string;
    operatorId?: string;
  }) {
    const refund = await this.prisma.customerRefund.findFirst({
      where: { id: payload.refundId, companyId: payload.companyId },
      include: {
        partner: { select: { id: true, name: true } },
        creditNote: { select: { creditNo: true } },
      },
    });

    if (!refund) {
      throw new BadRequestException('客户退款单不存在，无法生成凭证');
    }

    const amount = this.money(refund.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('退款金额必须大于0');
    }

    const refundPayableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'CUSTOMER_REFUND_PAYABLE',
      );
    const cashAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        this.paymentAccountKey(refund.method),
      );
    const journal =
      refund.method === 'CASH'
        ? {
            code: 'CSH',
            name: 'Cash Journal',
            type: JournalType.CASH,
          }
        : {
            code: 'BNK',
            name: 'Bank Journal',
            type: JournalType.BANK,
          };

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: journal.code,
      journalName: journal.name,
      journalType: journal.type,
      ref: `REFUND-${refund.id}`,
      description: `客户退款自动凭证: ${refund.refundNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...refundPayableAccount,
          debit: amount,
          partnerId: refund.partnerId,
          memo: `支付客户退款 ${refund.partner.name}`,
        },
        {
          ...cashAccount,
          credit: amount,
          partnerId: refund.partnerId,
          memo: `客户退款 ${refund.creditNote.creditNo}`,
        },
      ],
    });
  }

  async postSupplierCreditNotePostedEntry(payload: {
    companyId: string;
    supplierCreditNoteId: string;
    operatorId?: string;
  }) {
    const creditNote = await this.prisma.supplierCreditNote.findFirst({
      where: {
        id: payload.supplierCreditNoteId,
        companyId: payload.companyId,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseInvoice: { select: { invoiceNo: true } },
      },
    });

    if (!creditNote) {
      throw new BadRequestException('供应商贷项不存在，无法生成凭证');
    }

    const amount = this.money(creditNote.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('供应商贷项金额必须大于0');
    }

    const payableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'PAYABLE',
      );
    const inventoryAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'INVENTORY',
      );

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'PUR',
      journalName: 'Purchase Journal',
      journalType: JournalType.PURCHASE,
      ref: creditNote.creditNo,
      description: `供应商扣款自动凭证: ${creditNote.creditNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          ...payableAccount,
          debit: amount,
          partnerId: creditNote.supplierId,
          memo: `冲减应付 ${creditNote.purchaseInvoice.invoiceNo}`,
        },
        {
          ...inventoryAccount,
          credit: amount,
          partnerId: creditNote.supplierId,
          memo: `供应商扣款 ${creditNote.supplier.name}`,
        },
      ],
    });
  }

  async postSupplierPaymentEntry(payload: {
    companyId: string;
    supplierPaymentId: string;
    operatorId?: string;
  }) {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: {
        id: payload.supplierPaymentId,
        companyId: payload.companyId,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        allocations: {
          include: {
            purchaseInvoice: { select: { invoiceNo: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!payment) {
      throw new BadRequestException('供应商付款不存在，无法生成凭证');
    }

    const amount = this.money(payment.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('供应商付款金额必须大于0');
    }

    const allocatedAmount = this.money(
      payment.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Decimal(0),
      ),
    );
    if (allocatedAmount.gt(amount)) {
      throw new BadRequestException('供应商付款核销金额不能超过付款金额');
    }
    const unappliedAmount = this.money(amount.minus(allocatedAmount));

    const payableAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        'PAYABLE',
      );
    const advanceAccount = unappliedAmount.gt(0)
      ? await this.financeAccountMappingService.resolveLineAccount(
          payload.companyId,
          'SUPPLIER_ADVANCE',
        )
      : null;
    const cashAccount =
      await this.financeAccountMappingService.resolveLineAccount(
        payload.companyId,
        this.paymentAccountKey(payment.method),
      );
    const journal =
      payment.method === 'CASH'
        ? {
            code: 'CSH',
            name: 'Cash Journal',
            type: JournalType.CASH,
          }
        : {
            code: 'BNK',
            name: 'Bank Journal',
            type: JournalType.BANK,
          };

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: journal.code,
      journalName: journal.name,
      journalType: journal.type,
      ref: `SUPPAY-${payment.id}`,
      description: `供应商付款自动凭证: ${payment.paymentNo}`,
      createdBy: payload.operatorId,
      lines: [
        ...payment.allocations.map((allocation) => ({
          ...payableAccount,
          debit: this.money(allocation.amount),
          partnerId: payment.supplierId,
          memo: `冲销应付 ${allocation.purchaseInvoice.invoiceNo}`,
        })),
        ...(advanceAccount
          ? [
              {
                ...advanceAccount,
                debit: unappliedAmount,
                partnerId: payment.supplierId,
                memo: `供应商预付款 ${payment.supplier.name}`,
              },
            ]
          : []),
        {
          ...cashAccount,
          credit: amount,
          partnerId: payment.supplierId,
          memo: `供应商付款 ${payment.supplier.name}`,
        },
      ],
    });
  }

  async createBalancedEntry(input: CreateBalancedEntryInput) {
    await this.ensureDefaultMasterData(input.companyId);
    const entryDate = input.date ?? new Date();
    await this.accountingPeriodService?.assertOpenForDate(
      input.companyId,
      entryDate,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `journal-entry-${input.companyId}`,
      );

      const lines = input.lines.map((line) => ({
        ...line,
        debit: this.money(line.debit ?? 0),
        credit: this.money(line.credit ?? 0),
      }));

      this.validateLines(lines);
      const totalDebit = this.money(
        lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0)),
      );
      const totalCredit = this.money(
        lines.reduce((sum, line) => sum.plus(line.credit), new Decimal(0)),
      );

      if (!totalDebit.eq(totalCredit)) {
        throw new BadRequestException(
          `借贷不平衡: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}`,
        );
      }

      const journal = await tx.journal.upsert({
        where: {
          companyId_code: {
            companyId: input.companyId,
            code: input.journalCode,
          },
        },
        update: {
          name: input.journalName,
          type: input.journalType,
          isActive: true,
        },
        create: {
          companyId: input.companyId,
          code: input.journalCode,
          name: input.journalName,
          type: input.journalType,
        },
      });

      const entry = await tx.journalEntry.create({
        data: {
          entryNo: this.generateEntryNo(),
          date: entryDate,
          ref: input.ref,
          description: input.description,
          journalId: journal.id,
          companyId: input.companyId,
          createdBy: input.createdBy,
          postingStatus: EntryPostingStatus.POSTED,
          postedAt: new Date(),
          lines: {
            create: await Promise.all(
              lines.map(async (line, index) => {
                const account = await this.getPostingAccount(
                  tx,
                  input.companyId,
                  line.accountCode,
                );

                return {
                  lineNo: index + 1,
                  accountId: account.id,
                  partnerId: line.partnerId,
                  debit: line.debit,
                  credit: line.credit,
                  memo: line.memo,
                };
              }),
            ),
          },
        },
        include: {
          lines: {
            include: { account: true },
            orderBy: { lineNo: 'asc' },
          },
          journal: true,
        },
      });

      return {
        ...entry,
        totals: {
          debit: totalDebit.toNumber(),
          credit: totalCredit.toNumber(),
        },
      };
    });
  }

  private async splitPurchasePriceVariance(input: {
    companyId: string;
    lines: Array<{
      materialId: string;
      receivedQty: Decimal.Value;
      unitPrice: Decimal.Value;
    }>;
    totalVariance: Decimal;
    receivedCost: Decimal;
  }) {
    if (input.totalVariance.eq(0)) {
      return { inventory: new Decimal(0), expense: new Decimal(0) };
    }

    const totalReceivedQty = this.money(
      input.lines.reduce(
        (sum, line) => sum.plus(line.receivedQty),
        new Decimal(0),
      ),
    );
    if (totalReceivedQty.lte(0)) {
      return { inventory: new Decimal(0), expense: input.totalVariance };
    }

    const materialIds = [
      ...new Set(input.lines.map((line) => line.materialId)),
    ];
    const onHandRows = await this.prisma.stockQuant.groupBy({
      by: ['materialId'],
      where: {
        materialId: { in: materialIds },
        location: { companyId: input.companyId },
      },
      _sum: { quantity: true },
    });
    const onHandByMaterial = new Map(
      onHandRows.map((row) => [
        row.materialId,
        this.money(row._sum.quantity ?? 0),
      ]),
    );

    let inStockWeight = new Decimal(0);
    for (const line of input.lines) {
      const receivedQty = this.money(line.receivedQty);
      if (receivedQty.lte(0)) continue;

      const materialOnHand =
        onHandByMaterial.get(line.materialId) ?? new Decimal(0);
      const inStockQty = Decimal.min(
        receivedQty,
        Decimal.max(0, materialOnHand),
      );
      onHandByMaterial.set(
        line.materialId,
        Decimal.max(0, materialOnHand.minus(inStockQty)),
      );

      const lineWeightBase = input.receivedCost.gt(0)
        ? this.money(receivedQty.times(line.unitPrice))
        : receivedQty;
      const lineShareBase = input.receivedCost.gt(0)
        ? input.receivedCost
        : totalReceivedQty;
      inStockWeight = inStockWeight.plus(
        lineShareBase.gt(0)
          ? lineWeightBase.times(inStockQty.div(receivedQty))
          : 0,
      );
    }

    const splitBase = input.receivedCost.gt(0)
      ? input.receivedCost
      : totalReceivedQty;
    const inventoryShare = splitBase.gt(0)
      ? Decimal.min(1, Decimal.max(0, inStockWeight.div(splitBase)))
      : new Decimal(0);
    const inventory = this.money(input.totalVariance.times(inventoryShare));
    const expense = this.money(input.totalVariance.minus(inventory));
    return { inventory, expense };
  }

  private async ensureDefaultMasterData(companyId: string) {
    await this.financeAccountMappingService.ensureDefaultAccounts(companyId);

    await this.prisma.journal.upsert({
      where: { companyId_code: { companyId, code: 'GEN' } },
      update: {
        name: 'General Journal',
        type: JournalType.GENERAL,
        isActive: true,
      },
      create: {
        companyId,
        code: 'GEN',
        name: 'General Journal',
        type: JournalType.GENERAL,
      },
    });
  }

  private async getPostingAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    code: string,
  ) {
    const account = await tx.account.findFirst({
      where: {
        companyId,
        code,
        isActive: true,
      },
    });

    if (!account) {
      throw new BadRequestException(`会计科目不存在或已停用: ${code}`);
    }

    return account;
  }

  private paymentAccountKey(method: string): FinanceAccountMappingKey {
    if (method === 'CASH') return 'CASH';
    if (method === 'ALIPAY') return 'ALIPAY';
    if (method === 'WECHAT') return 'WECHAT';
    return 'BANK';
  }

  private validateLines(lines: Array<{ debit: Decimal; credit: Decimal }>) {
    if (!lines.length) {
      throw new BadRequestException('凭证分录不能为空');
    }

    for (const line of lines) {
      if (line.debit.lt(0) || line.credit.lt(0)) {
        throw new BadRequestException('分录金额不能为负数');
      }
      if (
        (line.debit.eq(0) && line.credit.eq(0)) ||
        (line.debit.gt(0) && line.credit.gt(0))
      ) {
        throw new BadRequestException('每行分录必须仅填写借方或贷方');
      }
    }
  }

  private generateEntryNo() {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const suffix = String(now.getTime()).slice(-6);
    return `JE-${datePart}-${suffix}`;
  }

  private money(value: Decimal.Value) {
    return new Decimal(roundDecimal(value));
  }
}
