import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { CrudModule } from '../crud/crud.module';
import { MetadataModule } from '../metadata/metadata.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { LlmAdapterService } from './llm-adapter.service';
import { PermissionsGuard } from '../guards/permissions.guard';

@Module({
  imports: [CrudModule, MetadataModule, WorkflowModule],
  controllers: [AIController],
  providers: [AIService, LlmAdapterService, PermissionsGuard],
  exports: [AIService],
})
export class AIModule {}
