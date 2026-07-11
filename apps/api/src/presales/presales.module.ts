import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { PresalesController } from './presales.controller';
import { PresalesService } from './presales.service';
import { QuotesController } from './quotes.controller';

@Module({
  controllers: [PresalesController, QuotesController],
  providers: [PresalesService, PermissionsGuard],
  exports: [PresalesService],
})
export class PresalesModule {}
