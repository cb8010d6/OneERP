import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderWorkflowListener } from './order-workflow.listener';
import { OrderCreatedListener } from './order-created.listener';
import { EventQueueModule } from '../core/events/event-queue.module';

@Module({
  imports: [InventoryModule, EventQueueModule],
  providers: [OrdersService, OrderWorkflowListener, OrderCreatedListener],
  controllers: [OrdersController],
})
export class OrdersModule {}
