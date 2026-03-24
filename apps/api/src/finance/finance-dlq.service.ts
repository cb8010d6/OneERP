import { Injectable } from '@nestjs/common';
import { EventQueueService } from '../core/events/event-queue.service';

@Injectable()
export class FinanceDlqService {
  constructor(private readonly eventQueueService: EventQueueService) {}

  async recordFailure(input: {
    eventName: string;
    payload: Record<string, unknown>;
    error: string;
    companyId?: string;
    maxAttempts?: number;
  }) {
    return this.eventQueueService.enqueue({
      eventName: input.eventName,
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
}
