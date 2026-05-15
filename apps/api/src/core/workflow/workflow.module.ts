import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { PermissionsGuard } from '../guards/permissions.guard';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, PermissionsGuard],
  exports: [WorkflowService],
})
export class WorkflowModule {}
