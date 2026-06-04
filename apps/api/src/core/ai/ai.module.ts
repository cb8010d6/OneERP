import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { CrudModule } from '../crud/crud.module';
import { MetadataModule } from '../metadata/metadata.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OrdersModule } from '../../orders/orders.module';
import { LlmAdapterService } from './llm-adapter.service';
import { AISettingsService } from './ai-settings.service';
import { PermissionsGuard } from '../guards/permissions.guard';

@Module({
  imports: [CrudModule, MetadataModule, WorkflowModule, OrdersModule],
  controllers: [AIController],
  providers: [
    AIService,
    AISettingsService,
    LlmAdapterService,
    PermissionsGuard,
  ],
  exports: [AIService],
})
export class AIModule {}
