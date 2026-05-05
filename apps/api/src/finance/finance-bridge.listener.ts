import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountingService } from './accounting.service';
import { FinanceDlqService } from './finance-dlq.service';

interface StockDepletedPayload {
  companyId: string;
  materialId: string;
  quantity: number;
  referenceNo?: string;
  unitCost?: number;
  operatorId?: string;
}

interface InvoicePostedPayload {
  companyId: string;
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
  ) {}

  @OnEvent('inventory.stock_depleted')
  async onStockDepleted(payload: StockDepletedPayload) {
    try {
      await this.accountingService.postStockDepletedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`库存事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'inventory.stock_depleted',
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }

  @OnEvent('finance.invoice.posted')
  async onInvoicePosted(payload: InvoicePostedPayload) {
    try {
      await this.accountingService.postInvoicePostedEntry(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`发票过账事件记账失败: ${message}`);
      await this.financeDlqService.recordFailure({
        eventName: 'finance.invoice.posted',
        payload: payload as unknown as Record<string, unknown>,
        error: message,
        companyId: payload.companyId,
      });
    }
  }
}
