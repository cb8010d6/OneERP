import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { StockQueryService } from './stock-query.service';
import { InventoryController } from './inventory.controller';
import { KyselyModule } from '../core/prisma/kysely.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';

@Module({
  imports: [KyselyModule],
  providers: [StockQueryService, InventoryService, PermissionsGuard],
  controllers: [InventoryController],
  exports: [StockQueryService, InventoryService],
})
export class InventoryModule {}
