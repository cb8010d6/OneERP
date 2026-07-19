import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountingService } from './accounting.service';
import { FinanceDlqService } from './finance-dlq.service';
import { PrismaService } from '../prisma/prisma.service';

interface StockDepletedPayload {
  companyId: string;
  idempotencyKey?: string;
  materialId: string;
  quantity: number;
  referenceNo?: string;
  unitCost?: number;
  operatorId?: string;
}

interface InvoicePostedPayload {
  companyId: string;
  idempotencyKey?: string;
  invoiceId: string;
  taxCodeId?: string | null;
  taxRate?: number;
  operatorId?: string;
}

interface PaymentRecordedPayload {
  companyId: string;
  idempotencyKey?: string;
  paymentId: string;
  operatorId?: string;
}

interface PaymentAppliedPayload {
  companyId: string;
  idempotencyKey?: string;
  paymentId: string;
  allocationIds: string[];
  operatorId?: string;
}

interface CreditNotePostedPayload {
  companyId: string;
  idempotencyKey?: string;
  creditNoteId: string;
  operatorId?: string;
}

interface CustomerRefundPostedPayload {
  companyId: string;
  idempotencyKey?: string;
  refundId: string;
  operatorId?: string;
}

interface PurchaseInvoicePostedPayload {
  companyId: string;
  idempotencyKey?: string;
  purchaseInvoiceId: string;
  operatorId?: string;
}

interface SupplierCreditNotePostedPayload {
  companyId: string;
  idempotencyKey?: string;
  supplierCreditNoteId: string;
  operatorId?: string;
}

interface SupplierPaymentPostedPayload {
  companyId: string;
  idempotencyKey?: string;
  supplierPaymentId: string;
  operatorId?: string;
}

@Injectable()
export class FinanceBridgeListener {
  private readonly logger = new Logger(FinanceBridgeListener.name);

  constructor(
    private readonly accountingService: AccountingService,
    private readonly financeDlqService: FinanceDlqService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('inventory.stock_depleted')
  async onStockDepleted(payload: StockDepletedPayload) {
    try {
      // 幂等检查：若已有同 referenceNo 的 INV 凭证则跳过
      if (payload.referenceNo) {
        const existing = await this.prisma.journalEntry.findFirst({
          where: {
            companyId: payload.companyId,
            ref: payload.referenceNo,
            journal: { code: 'INV' },
          },
          select: { id: true },
        });

        if (existing) {
          this.logger.debug(
            `幂等跳过库存凭证: ref=${payload.referenceNo} 已存在 (id=${existing.id})`,
          );
          return;
        }
      }

      await this.accountingService.postStockDepletedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`库存事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'inventory.stock_depleted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.invoice.posted')
  async onInvoicePosted(payload: InvoicePostedPayload) {
    try {
      // 幂等检查：若已有同 invoiceId 的 SAL 凭证则跳过
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: payload.invoiceId, companyId: payload.companyId },
        select: { invoiceNo: true },
      });

      if (invoice?.invoiceNo) {
        const existing = await this.prisma.journalEntry.findFirst({
          where: {
            companyId: payload.companyId,
            ref: invoice.invoiceNo,
            journal: { code: 'SAL' },
          },
          select: { id: true },
        });

        if (existing) {
          this.logger.debug(
            `幂等跳过发票凭证: ref=${invoice.invoiceNo} 已存在 (id=${existing.id})`,
          );
          return;
        }
      }

      await this.accountingService.postInvoicePostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`发票过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.invoice.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.payment.recorded')
  async onPaymentRecorded(payload: PaymentRecordedPayload) {
    try {
      const payment = await this.prisma.payment.findFirst({
        where: { id: payload.paymentId, companyId: payload.companyId },
        select: { id: true, postingStatus: true },
      });

      if (!payment) {
        throw new Error('收款记录不存在，无法生成凭证');
      }

      if (payment.postingStatus === 'POSTED') {
        this.logger.debug(`幂等跳过收款凭证: payment=${payment.id} 已过账`);
        return;
      }

      const ref = `PAY-${payload.paymentId}`;
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref,
          journal: { code: { in: ['BNK', 'CSH'] } },
        },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.payment.update({
          where: { id: payload.paymentId },
          data: { postingStatus: 'POSTED', postedAt: new Date() },
        });
        this.logger.debug(
          `幂等补记收款状态: ref=${ref} 已存在凭证 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postPaymentReceivedEntry(payload);
      await this.prisma.payment.update({
        where: { id: payload.paymentId },
        data: { postingStatus: 'POSTED', postedAt: new Date() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`收款事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.payment.recorded',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.payment.applied')
  async onPaymentApplied(payload: PaymentAppliedPayload) {
    try {
      const firstAllocationId = payload.allocationIds[0];
      if (!firstAllocationId) {
        throw new Error('核销明细不能为空');
      }

      const ref = `PAY-APPLY-${firstAllocationId}`;
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref,
          journal: { code: 'SAL' },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过预收款核销凭证: ref=${ref} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postCustomerAdvanceAppliedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`预收款核销事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.payment.applied',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.credit_note.posted')
  async onCreditNotePosted(payload: CreditNotePostedPayload) {
    try {
      const creditNote = await this.prisma.creditNote.findFirst({
        where: { id: payload.creditNoteId, companyId: payload.companyId },
        select: { creditNo: true },
      });

      if (!creditNote) {
        throw new Error('贷项凭证不存在，无法生成凭证');
      }

      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref: creditNote.creditNo,
          journal: { code: 'SAL' },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过贷项凭证: ref=${creditNote.creditNo} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postCreditNotePostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`贷项凭证过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.credit_note.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.customer_refund.posted')
  async onCustomerRefundPosted(payload: CustomerRefundPostedPayload) {
    try {
      const refund = await this.prisma.customerRefund.findFirst({
        where: { id: payload.refundId, companyId: payload.companyId },
        select: { id: true },
      });

      if (!refund) {
        throw new Error('客户退款单不存在，无法生成凭证');
      }

      const ref = `REFUND-${payload.refundId}`;
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref,
          journal: { code: { in: ['BNK', 'CSH'] } },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过客户退款凭证: ref=${ref} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postCustomerRefundEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`客户退款事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.customer_refund.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('purchase.invoice.posted')
  async onPurchaseInvoicePosted(payload: PurchaseInvoicePostedPayload) {
    try {
      const invoice = await this.prisma.purchaseInvoice.findFirst({
        where: {
          id: payload.purchaseInvoiceId,
          companyId: payload.companyId,
        },
        select: { invoiceNo: true },
      });

      if (!invoice) {
        throw new Error('应付发票不存在，无法生成凭证');
      }

      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref: invoice.invoiceNo,
          journal: { code: 'PUR' },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过应付发票凭证: ref=${invoice.invoiceNo} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postPurchaseInvoicePostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`应付发票过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'purchase.invoice.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('purchase.supplier_credit_note.posted')
  async onSupplierCreditNotePosted(payload: SupplierCreditNotePostedPayload) {
    try {
      const creditNote = await this.prisma.supplierCreditNote.findFirst({
        where: {
          id: payload.supplierCreditNoteId,
          companyId: payload.companyId,
        },
        select: { creditNo: true },
      });

      if (!creditNote) {
        throw new Error('供应商贷项不存在，无法生成凭证');
      }

      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref: creditNote.creditNo,
          journal: { code: 'PUR' },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过供应商贷项凭证: ref=${creditNote.creditNo} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postSupplierCreditNotePostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`供应商贷项过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'purchase.supplier_credit_note.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('purchase.supplier_payment.posted')
  async onSupplierPaymentPosted(payload: SupplierPaymentPostedPayload) {
    try {
      const payment = await this.prisma.supplierPayment.findFirst({
        where: {
          id: payload.supplierPaymentId,
          companyId: payload.companyId,
        },
        select: { id: true },
      });

      if (!payment) {
        throw new Error('供应商付款不存在，无法生成凭证');
      }

      const ref = `SUPPAY-${payload.supplierPaymentId}`;
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          companyId: payload.companyId,
          ref,
          journal: { code: { in: ['BNK', 'CSH'] } },
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等跳过供应商付款凭证: ref=${ref} 已存在 (id=${existing.id})`,
        );
        return;
      }

      await this.accountingService.postSupplierPaymentEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`供应商付款事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'purchase.supplier_payment.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }
}
