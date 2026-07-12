import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { EngineeringDocumentsController } from './engineering-documents.controller';
import { EngineeringDocumentsService } from './engineering-documents.service';
import { EngineeringChangeOrdersController } from './engineering-change-orders.controller';
import { EngineeringChangeOrdersService } from './engineering-change-orders.service';

@Module({
  controllers: [
    EngineeringDocumentsController,
    EngineeringChangeOrdersController,
  ],
  providers: [
    EngineeringDocumentsService,
    EngineeringChangeOrdersService,
    PermissionsGuard,
  ],
  exports: [EngineeringDocumentsService, EngineeringChangeOrdersService],
})
export class EngineeringModule {}
