import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, EventDlq } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface EnqueueEventInput {
  eventName: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  companyId?: string;
  maxAttempts?: number;
  nextRetryAt?: Date;
}

export interface EventQueueResult {
  id: string;
  status: string;
  error?: string;
}

export interface RetryPendingResult {
  total: number;
  results: EventQueueResult[];
}

@Injectable()
export class EventQueueService {
  private readonly logger = new Logger(EventQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 入队事件。若提供了 idempotencyKey，则先检查是否已有同名 RESOLVED 事件，
   * 若已存在则跳过入队并返回 null（幂等语义）。
   */
  async enqueue(input: EnqueueEventInput) {
    return this.enqueueWithClient(this.prisma, input);
  }

  async enqueueInTransaction(
    tx: Prisma.TransactionClient,
    input: EnqueueEventInput,
  ) {
    return this.enqueueWithClient(tx, input);
  }

  private async enqueueWithClient(
    client: PrismaService | Prisma.TransactionClient,
    input: EnqueueEventInput,
  ) {
    if (input.idempotencyKey) {
      const existing = await client.eventDlq.findFirst({
        where: {
          eventName: input.eventName,
          idempotencyKey: input.idempotencyKey,
          status: 'RESOLVED',
        },
        select: { id: true },
      });

      if (existing) {
        this.logger.debug(
          `幂等去重: ${input.eventName} key=${input.idempotencyKey} 已处理 (id=${existing.id})`,
        );
        return null;
      }
    }

    return client.eventDlq.create({
      data: {
        eventName: input.eventName,
        idempotencyKey: input.idempotencyKey ?? null,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        error: '',
        companyId: input.companyId,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        status: 'PENDING',
        nextRetryAt: input.nextRetryAt ?? new Date(),
      },
    });
  }

  async publish(input: EnqueueEventInput) {
    const queued = await this.enqueue(input);
    if (!queued) {
      return null; // 幂等：已被处理过
    }
    await this.dispatchById(queued.id);
    return queued;
  }

  async list(limit = 50, companyId?: string) {
    return this.prisma.eventDlq.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    });
  }

  async dispatchById(id: string): Promise<EventQueueResult> {
    const item = await this.prisma.eventDlq.findUnique({ where: { id } });
    if (!item) {
      return { id, status: 'NOT_FOUND' };
    }

    return this.processItem(item);
  }

  async retryPending(
    limit = 20,
    companyId?: string,
    eventNames?: string[],
  ): Promise<RetryPendingResult> {
    const now = new Date();
    const scopedEventNames = [...new Set(eventNames ?? [])].filter(Boolean);
    const items = await this.prisma.eventDlq.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(scopedEventNames.length
          ? { eventName: { in: scopedEventNames } }
          : {}),
        status: { in: ['PENDING', 'RETRYING'] },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: [{ updatedAt: 'asc' }],
      take: limit,
    });

    const results: EventQueueResult[] = [];
    for (const item of items) {
      results.push(await this.processItem(item));
    }

    return { total: items.length, results };
  }

  private async processItem(item: EventDlq): Promise<EventQueueResult> {
    if (item.attempts >= item.maxAttempts) {
      await this.markFailed(item.id, item.error || '超过最大重试次数');
      return { id: item.id, status: 'FAILED', error: item.error };
    }

    // 幂等检查：重试时若已有同 key 的 RESOLVED 记录则跳过
    if (item.idempotencyKey) {
      const duplicate = await this.prisma.eventDlq.findFirst({
        where: {
          eventName: item.eventName,
          idempotencyKey: item.idempotencyKey,
          status: 'RESOLVED',
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        this.logger.debug(
          `重试幂等去重: ${item.eventName} key=${item.idempotencyKey} 已由 ${duplicate.id} 处理`,
        );
        await this.prisma.eventDlq.update({
          where: { id: item.id },
          data: { status: 'RESOLVED', error: '', nextRetryAt: null },
        });
        return { id: item.id, status: 'RESOLVED' };
      }
    }

    const claimed = await this.prisma.eventDlq.updateMany({
      where: {
        id: item.id,
        status: { in: ['PENDING', 'RETRYING'] },
      },
      data: {
        status: 'RETRYING',
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      return { id: item.id, status: 'SKIPPED' };
    }

    try {
      await this.eventEmitter.emitAsync(
        item.eventName,
        this.payloadToRecord(item.payload),
      );

      await this.prisma.eventDlq.update({
        where: { id: item.id },
        data: {
          status: 'RESOLVED',
          nextRetryAt: null,
          error: '',
        },
      });

      return { id: item.id, status: 'RESOLVED' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = await this.prisma.eventDlq.findUnique({
        where: { id: item.id },
      });
      const attempts = latest?.attempts ?? item.attempts + 1;
      const maxAttempts = latest?.maxAttempts ?? item.maxAttempts;

      if (attempts >= maxAttempts) {
        await this.markFailed(item.id, message);
        return { id: item.id, status: 'FAILED', error: message };
      }

      await this.prisma.eventDlq.update({
        where: { id: item.id },
        data: {
          status: 'PENDING',
          error: message,
          nextRetryAt: this.getNextRetryAt(attempts),
        },
      });

      this.logger.warn(
        `Event retry scheduled: ${item.eventName} id=${item.id} attempts=${attempts}`,
      );
      return { id: item.id, status: 'PENDING', error: message };
    }
  }

  private async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.eventDlq.update({
      where: { id },
      data: {
        status: 'FAILED',
        error,
        nextRetryAt: null,
      },
    });
  }

  private getNextRetryAt(attempts: number): Date {
    const baseMs = 30_000;
    const capped = Math.min(
      baseMs * 2 ** Math.max(0, attempts - 1),
      30 * 60_000,
    );
    const jitter = Math.floor(Math.random() * 5_000);
    return new Date(Date.now() + capped + jitter);
  }

  private payloadToRecord(payload: Prisma.JsonValue): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return {};
  }
}
