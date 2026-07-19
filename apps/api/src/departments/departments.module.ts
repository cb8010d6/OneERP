import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { PermissionsGuard } from '../core/guards/permissions.guard';

@Module({
  providers: [DepartmentsService, PermissionsGuard],
  controllers: [DepartmentsController],
})
export class DepartmentsModule {}
