import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditDlqListener } from './audit-dlq.listener';
import { EventQueueModule } from '../events/event-queue.module';

@Module({
  imports: [EventQueueModule],
  controllers: [AuditController],
  providers: [AuditService, AuditDlqListener],
  exports: [AuditService],
})
export class AuditModule {}
