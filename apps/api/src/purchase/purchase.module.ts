import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';

@Module({
  imports: [PrismaModule, InventoryModule],
  controllers: [PurchaseController],
  providers: [PurchaseService, PermissionsGuard],
  exports: [PurchaseService],
})
export class PurchaseModule {}
