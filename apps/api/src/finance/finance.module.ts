import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { TaxCodeController } from './tax-code.controller';
import { VendorBillController } from './vendor-bill.controller';
import { VendorBillService } from './vendor-bill.service';
import { ThreeWayMatchService } from './three-way-match.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingService } from './accounting.service';
import { FinanceDlqService } from './finance-dlq.service';
import { FinanceBridgeListener } from './finance-bridge.listener';
import { EventQueueModule } from '../core/events/event-queue.module';

@Module({
  imports: [PrismaModule, EventQueueModule],
  controllers: [FinanceController, TaxCodeController, VendorBillController],
  providers: [
    FinanceService,
    VendorBillService,
    ThreeWayMatchService,
    AccountingService,
    FinanceDlqService,
    FinanceBridgeListener,
  ],
  exports: [
    AccountingService,
    FinanceDlqService,
    VendorBillService,
    ThreeWayMatchService,
  ],
})
export class FinanceModule {}
