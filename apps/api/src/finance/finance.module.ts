import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingService } from './accounting.service';
import { FinanceAccountMappingService } from './finance-account-mapping.service';
import { FinanceDlqService } from './finance-dlq.service';
import { FinanceBridgeListener } from './finance-bridge.listener';
import { AccountingPeriodService } from './accounting-period.service';
import { FinanceReportsService } from './finance-reports.service';
import { EventQueueModule } from '../core/events/event-queue.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';

@Module({
  imports: [PrismaModule, EventQueueModule],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    AccountingService,
    FinanceAccountMappingService,
    FinanceDlqService,
    AccountingPeriodService,
    FinanceBridgeListener,
    FinanceReportsService,
    PermissionsGuard,
  ],
  exports: [
    AccountingService,
    FinanceAccountMappingService,
    FinanceDlqService,
    AccountingPeriodService,
    FinanceReportsService,
  ],
})
export class FinanceModule {}
