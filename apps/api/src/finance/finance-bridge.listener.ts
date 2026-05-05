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

interface VendorBillPostedPayload {
  companyId: string;
  idempotencyKey?: string;
  invoiceId: string;
  taxCodeId?: string | null;
  taxAccountId?: string | null;
  taxRate?: number;
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

  @OnEvent('finance.vendor_bill.posted')
  async onVendorBillPosted(payload: VendorBillPostedPayload) {
    try {
      const invoice = await this.prisma.purchaseInvoice.findFirst({
        where: { id: payload.invoiceId, companyId: payload.companyId },
        select: { invoiceNo: true },
      });

      if (invoice?.invoiceNo) {
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
            `幂等跳过采购凭证: ref=${invoice.invoiceNo} 已存在 (id=${existing.id})`,
          );
          return;
        }
      }

      await this.accountingService.postVendorBillPostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`采购发票过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.vendor_bill.posted',
        idempotencyKey: payload.idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }
}
