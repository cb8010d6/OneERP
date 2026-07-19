import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { EventQueueModule } from '../core/events/event-queue.module';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { SupplierStatementService } from './supplier-statement.service';
import { PurchaseQueryService } from './purchase-query.service';

@Module({
  imports: [PrismaModule, InventoryModule, FinanceModule, EventQueueModule],
  controllers: [PurchaseController],
  providers: [
    SupplierStatementService,
    PurchaseQueryService,
    PurchaseService,
    PermissionsGuard,
  ],
  exports: [PurchaseService],
})
export class PurchaseModule {}
