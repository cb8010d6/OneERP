import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface AuditLogFailedPayload {
  userId: string;
  companyId: string;
  entity: string;
  entityId: string;
  action: string;
  details: Prisma.InputJsonValue;
  originalError?: string;
}

@Injectable()
export class AuditDlqListener {
  private readonly logger = new Logger(AuditDlqListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('audit.log.failed')
  async handleAuditLogFailed(payload: AuditLogFailedPayload) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: payload.userId,
          companyId: payload.companyId,
          entity: payload.entity,
          entityId: payload.entityId,
          action: payload.action,
          details: {
            ...(payload.details as Record<string, unknown>),
            retryReason: payload.originalError || 'DLQ retry',
          },
        },
      });
      this.logger.log(
        `DLQ retry succeeded for ${payload.entity}:${payload.entityId}`,
      );
    } catch (error) {
      this.logger.error(
        `DLQ retry failed for ${payload.entity}:${payload.entityId}: ${String(error)}`,
      );
      throw error;
    }
  }
}
