import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EventQueueRunner } from './event-queue.runner';
import { EventQueueService } from './event-queue.service';

@Module({
  imports: [PrismaModule],
  providers: [EventQueueService, EventQueueRunner],
  exports: [EventQueueService],
})
export class EventQueueModule {}
