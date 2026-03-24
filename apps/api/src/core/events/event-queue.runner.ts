import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventQueueService } from './event-queue.service';

@Injectable()
export class EventQueueRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventQueueRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly eventQueueService: EventQueueService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.safeTick();
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async safeTick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const result = await this.eventQueueService.retryPending(50);
      if (result.total > 0) {
        this.logger.log(`Event retry tick processed: ${result.total}`);
      }
    } catch (error) {
      this.logger.error(
        'Event retry tick failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
