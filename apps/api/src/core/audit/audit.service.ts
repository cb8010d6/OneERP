import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventQueueService } from '../events/event-queue.service';

type CrudAction = 'CRUD_CREATE' | 'CRUD_UPDATE' | 'CRUD_DELETE';

interface CrudAuditPayload {
  modelName: string;
  recordId: string;
  companyId?: string;
  userId?: string;
  action: CrudAction;
  before?: unknown;
  after?: unknown;
  input?: Record<string, unknown>;
}

const MODEL_ALIASES: Record<string, string[]> = {
  order: ['order', 'sale_order'],
  workOrder: ['workOrder', 'work_order'],
  invoice: ['invoice'],
  partner: ['partner'],
  stockQuant: ['stockQuant', 'stock_quant'],
  fileRecord: ['fileRecord', 'file_record'],
  department: ['department'],
  userCompanyRole: ['userCompanyRole', 'user_company_role'],
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventQueueService: EventQueueService,
  ) {}

  async logCrudAction(payload: CrudAuditPayload) {
    if (!payload.companyId || !payload.userId) {
      return;
    }

    const entity = MODEL_ALIASES[payload.modelName]?.[0] ?? payload.modelName;
    const details = this.toJsonValue(this.buildCrudDetails(payload));

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: payload.userId,
          companyId: payload.companyId,
          entity,
          entityId: payload.recordId,
          action: payload.action,
          details,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log for ${payload.modelName}:${payload.recordId}, queuing to DLQ`,
      );
      this.logger.debug(String(error));

      try {
        await this.eventQueueService.enqueue({
          eventName: 'audit.log.failed',
          idempotencyKey: `audit:${payload.companyId}:${payload.userId}:${entity}:${payload.recordId}:${payload.action}`,
          payload: {
            userId: payload.userId,
            companyId: payload.companyId,
            entity,
            entityId: payload.recordId,
            action: payload.action,
            details,
            originalError: String(error),
          },
          companyId: payload.companyId,
          maxAttempts: 3,
        });
      } catch (dlqError) {
        this.logger.error(
          `Failed to enqueue audit log to DLQ: ${String(dlqError)}`,
        );
      }
    }
  }

  async addComment(
    modelName: string,
    recordId: string,
    companyId: string,
    userId: string,
    content: string,
  ) {
    const trimmed = content.trim();
    const entity = MODEL_ALIASES[modelName]?.[0] ?? modelName;

    const created = await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity,
        entityId: recordId,
        action: 'USER_COMMENT',
        details: {
          content: trimmed,
        },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return {
      id: created.id,
      action: created.action,
      createdAt: created.createdAt,
      user: created.user,
      details: created.details,
    };
  }

  async getTimeline(modelName: string, recordId: string, companyId: string) {
    const entities = MODEL_ALIASES[modelName] ?? [modelName];

    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: { in: entities },
        entityId: recordId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 100,
    });

    return {
      modelName,
      recordId,
      events: logs.map((item) => ({
        id: item.id,
        action: item.action,
        createdAt: item.createdAt,
        user: item.user,
        details: item.details,
      })),
    };
  }

  async listActionLogs(
    companyId: string,
    action: string,
    options?: {
      entity?: string;
      limit?: number;
      startDate?: string;
      endDate?: string;
      userId?: string;
      status?: 'POSTED' | 'FAILED' | 'SKIPPED';
    },
  ) {
    const limit = Math.min(Math.max(Number(options?.limit ?? 20), 1), 100);
    const createdAt: Prisma.DateTimeFilter = {};
    if (options?.startDate) {
      createdAt.gte = new Date(options.startDate);
    }
    if (options?.endDate) {
      createdAt.lte = new Date(options.endDate);
    }

    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        action,
        ...(options?.entity ? { entity: options.entity } : {}),
        ...(options?.userId ? { userId: options.userId } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: limit,
    });
    const status = options?.status;
    const filteredLogs = status
      ? logs.filter((item) => this.auditDetailsHasStatus(item.details, status))
      : logs;

    return {
      action,
      events: filteredLogs.map((item) => ({
        id: item.id,
        action: item.action,
        entity: item.entity,
        entityId: item.entityId,
        createdAt: item.createdAt,
        user: item.user,
        details: item.details,
      })),
    };
  }

  private auditDetailsHasStatus(
    details: Prisma.JsonValue,
    status: 'POSTED' | 'FAILED' | 'SKIPPED',
  ) {
    if (!this.isRecord(details)) {
      return false;
    }
    const key =
      status === 'POSTED'
        ? 'posted'
        : status === 'FAILED'
          ? 'failed'
          : 'skipped';
    return Number(details[key] ?? 0) > 0;
  }

  private buildCrudDetails(payload: CrudAuditPayload) {
    if (payload.action === 'CRUD_CREATE') {
      return {
        input: payload.input ?? {},
        after: payload.after,
      };
    }

    if (payload.action === 'CRUD_DELETE') {
      return {
        before: payload.before,
      };
    }

    const diff = this.buildDiff(payload.before, payload.after);
    return {
      input: payload.input ?? {},
      diff,
    };
  }

  private buildDiff(before: unknown, after: unknown) {
    if (!this.isRecord(before) || !this.isRecord(after)) {
      return { before, after };
    }

    const changed: Record<string, { before: unknown; after: unknown }> = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (this.shouldIgnoreField(key)) {
        continue;
      }
      const beforeValue = before[key];
      const afterValue = after[key];
      if (!this.areSame(beforeValue, afterValue)) {
        changed[key] = {
          before: beforeValue,
          after: afterValue,
        };
      }
    }

    return changed;
  }

  private shouldIgnoreField(key: string) {
    return key === 'updatedAt';
  }

  private areSame(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
