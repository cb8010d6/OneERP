import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventQueueService } from '../core/events/event-queue.service';

@Injectable()
export class FinanceDlqService {
  private readonly logger = new Logger(FinanceDlqService.name);

  constructor(private readonly eventQueueService: EventQueueService) {}

  async recordFailure(input: {
    eventName: string;
    idempotencyKey?: string;
    payload: Record<string, unknown>;
    error: string;
    companyId?: string;
    maxAttempts?: number;
  }) {
    return this.eventQueueService.enqueue({
      eventName: input.eventName,
      idempotencyKey: input.idempotencyKey,
      payload: {
        ...input.payload,
        _dlqError: input.error,
      },
      companyId: input.companyId,
      maxAttempts: input.maxAttempts ?? 5,
      nextRetryAt: new Date(Date.now() + 60 * 1000),
    });
  }

  async list(limit = 50) {
    return this.eventQueueService.list(limit);
  }

  async retryPending(limit = 20) {
    return this.eventQueueService.retryPending(limit);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCronRetry() {
    this.logger.log('Running scheduled DLQ retry...');
    try {
      const result = await this.retryPending(50);
      if (result.total > 0) {
        const succeeded = result.results.filter(
          (r) => r.status === 'RESOLVED',
        ).length;
        const failed = result.results.filter(
          (r) => r.status === 'FAILED',
        ).length;
        this.logger.log(
          `DLQ retry completed. Processed: ${result.total}, Succeeded: ${succeeded}, Failed: ${failed}`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to run scheduled DLQ retry', error);
    }
  }
}
