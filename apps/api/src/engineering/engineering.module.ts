import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { EngineeringDocumentsController } from './engineering-documents.controller';
import { EngineeringDocumentsService } from './engineering-documents.service';

@Module({
  controllers: [EngineeringDocumentsController],
  providers: [EngineeringDocumentsService, PermissionsGuard],
  exports: [EngineeringDocumentsService],
})
export class EngineeringModule {}
