import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { PresalesController } from './presales.controller';
import { PresalesService } from './presales.service';
import { QuotesController } from './quotes.controller';
import { ContractsController } from './contracts.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [PresalesController, QuotesController, ContractsController],
  providers: [PresalesService, PermissionsGuard],
  exports: [PresalesService],
})
export class PresalesModule {}
