import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { KyselyModule } from '../core/prisma/kysely.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';

@Module({
  imports: [KyselyModule],
  providers: [InventoryService, PermissionsGuard],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
