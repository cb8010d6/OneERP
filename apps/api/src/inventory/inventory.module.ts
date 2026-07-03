import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { StockQueryService } from './stock-query.service';
import { InventoryController } from './inventory.controller';
import { KyselyModule } from '../core/prisma/kysely.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { EventQueueModule } from '../core/events/event-queue.module';

@Module({
  imports: [KyselyModule, EventQueueModule],
  providers: [StockQueryService, InventoryService, PermissionsGuard],
  controllers: [InventoryController],
  exports: [StockQueryService, InventoryService],
})
export class InventoryModule {}
