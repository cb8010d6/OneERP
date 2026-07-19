import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseModule } from '../purchase/purchase.module';

@Module({
  imports: [PrismaModule, InventoryModule, PurchaseModule],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
