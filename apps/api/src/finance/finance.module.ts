import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingService } from './accounting.service';
import { FinanceDlqService } from './finance-dlq.service';
import { FinanceBridgeListener } from './finance-bridge.listener';
import { EventQueueModule } from '../core/events/event-queue.module';

@Module({
  imports: [PrismaModule, EventQueueModule],
  controllers: [FinanceController],
  providers: [FinanceService, AccountingService, FinanceDlqService, FinanceBridgeListener],
  exports: [AccountingService, FinanceDlqService],
})
export class FinanceModule {}
