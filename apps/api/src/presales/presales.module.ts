import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { PresalesController } from './presales.controller';
import { PresalesService } from './presales.service';

@Module({
  controllers: [PresalesController],
  providers: [PresalesService, PermissionsGuard],
  exports: [PresalesService],
})
export class PresalesModule {}
