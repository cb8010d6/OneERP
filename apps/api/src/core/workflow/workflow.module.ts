import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { PermissionsGuard } from '../guards/permissions.guard';
import { EventQueueModule } from '../events/event-queue.module';

@Module({
  imports: [EventQueueModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, PermissionsGuard],
  exports: [WorkflowService],
})
export class WorkflowModule {}
