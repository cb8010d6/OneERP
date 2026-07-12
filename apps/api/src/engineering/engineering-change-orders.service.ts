import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEngineeringChangeOrderDto,
  DecideEngineeringChangeOrderDto,
  EngineeringChangeImpactDto,
} from './dto/engineering-change-orders.dto';

const ECO_SEQUENCE = 'ENGINEERING_CHANGE_ORDER';

@Injectable()
export class EngineeringChangeOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string, documentId?: string) {
    return this.prisma.engineeringChangeOrder.findMany({
      where: {
        companyId,
        ...(documentId ? { engineeringDocumentId: documentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: this.include(),
    });
  }

  async preview(
    companyId: string,
    documentId: string,
    targetRevisionId: string,
  ) {
    const context = await this.readChangeContext(
      this.prisma,
      companyId,
      documentId,
      targetRevisionId,
    );
    const affectedWorkOrders = await this.findAffectedWorkOrders(
      this.prisma,
      companyId,
      context.sourceRevision.id,
    );
    return {
      document: context.document,
      sourceRevision: context.sourceRevision,
      targetRevision: context.targetRevision,
      affectedWorkOrders,
    };
  }

  async create(
    companyId: string,
    operatorId: string,
    documentId: string,
    data: CreateEngineeringChangeOrderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.readChangeContext(
        tx,
        companyId,
        documentId,
        data.targetRevisionId,
      );
      const affected = await this.findAffectedWorkOrders(
        tx,
        companyId,
        context.sourceRevision.id,
      );
      this.validateImpactCoverage(affected, data.impacts);

      const year = new Date().getUTCFullYear();
      const sequence = await tx.documentSequence.upsert({
        where: {
          companyId_documentType_year: {
            companyId,
            documentType: ECO_SEQUENCE,
            year,
          },
        },
        create: {
          companyId,
          documentType: ECO_SEQUENCE,
          year,
          lastValue: 1,
        },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });
      const ecoNo = `ECO-${year}-${String(sequence.lastValue).padStart(6, '0')}`;
      const eco = await tx.engineeringChangeOrder.create({
        data: {
          ecoNo,
          engineeringDocumentId: documentId,
          sourceRevisionId: context.sourceRevision.id,
          targetRevisionId: context.targetRevision.id,
          companyId,
          reason: data.reason.trim(),
          impactAssessment: data.impactAssessment.trim(),
          materialDisposition: data.materialDisposition.trim(),
          createdById: operatorId,
          impacts: {
            create: data.impacts.map((impact) => ({
              workOrderId: impact.workOrderId,
              companyId,
              decision: impact.decision,
              note: impact.note?.trim() || null,
            })),
          },
        },
        include: this.include(),
      });
      await this.writeAudit(tx, companyId, operatorId, eco.id, 'ECO_CREATED', {
        ecoNo,
        documentId,
        sourceRevisionId: context.sourceRevision.id,
        targetRevisionId: context.targetRevision.id,
        impacts: data.impacts,
      });
      return eco;
    });
  }

  async submit(companyId: string, operatorId: string, ecoId: string) {
    return this.prisma.$transaction(async (tx) => {
      const eco = await tx.engineeringChangeOrder.findFirst({
        where: { id: ecoId, companyId },
      });
      if (!eco) throw new NotFoundException('工程变更单不存在或无权访问');
      if (eco.status !== 'DRAFT')
        throw new ConflictException('工程变更单不在草稿状态');
      if (eco.createdById !== operatorId) {
        throw new BadRequestException('只有工程变更单创建人可以提交审批');
      }
      const changed = await tx.engineeringChangeOrder.updateMany({
        where: { id: eco.id, status: 'DRAFT' },
        data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException('工程变更单状态已变化');
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        eco.id,
        'ECO_SUBMITTED',
        {},
      );
      return { id: eco.id, status: 'PENDING_APPROVAL' };
    });
  }

  async decide(
    companyId: string,
    operatorId: string,
    ecoId: string,
    data: DecideEngineeringChangeOrderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const eco = await tx.engineeringChangeOrder.findFirst({
        where: { id: ecoId, companyId },
        include: {
          impacts: true,
          engineeringDocument: true,
          sourceRevision: true,
          targetRevision: true,
        },
      });
      if (!eco) throw new NotFoundException('工程变更单不存在或无权访问');
      if (eco.status !== 'PENDING_APPROVAL') {
        throw new ConflictException('工程变更单不在待批准状态');
      }
      if (eco.createdById === operatorId) {
        throw new BadRequestException('工程变更单批准人与创建人必须不同');
      }
      if (data.decision === 'REJECT') {
        if (!data.comment?.trim())
          throw new BadRequestException('驳回必须填写原因');
        await tx.engineeringDocumentRevision.update({
          where: { id: eco.targetRevisionId },
          data: {
            status: 'CHANGES_REQUESTED',
            reviewComment: data.comment.trim(),
          },
        });
        await tx.engineeringChangeOrder.update({
          where: { id: eco.id },
          data: {
            status: 'REJECTED',
            approvedById: operatorId,
            rejectedAt: new Date(),
            approvalComment: data.comment.trim(),
          },
        });
        await this.writeAudit(
          tx,
          companyId,
          operatorId,
          eco.id,
          'ECO_REJECTED',
          {
            comment: data.comment.trim(),
          },
        );
        return { id: eco.id, status: 'REJECTED' };
      }

      if (
        eco.engineeringDocument.currentReleasedRevisionId !==
          eco.sourceRevisionId ||
        eco.sourceRevision.status !== 'RELEASED' ||
        eco.targetRevision.status !== 'PENDING_APPROVAL'
      ) {
        throw new ConflictException('工程版本状态已变化，请重新评估后再批准');
      }
      const affected = await this.findAffectedWorkOrders(
        tx,
        companyId,
        eco.sourceRevisionId,
      );
      this.validateImpactCoverage(
        affected,
        eco.impacts as EngineeringChangeImpactDto[],
      );

      const now = new Date();
      await tx.engineeringDocumentRevision.update({
        where: { id: eco.targetRevisionId },
        data: {
          status: 'RELEASED',
          approvedById: operatorId,
          approvedAt: now,
          releasedAt: now,
        },
      });
      await tx.engineeringDocumentRevision.update({
        where: { id: eco.sourceRevisionId },
        data: { status: 'OBSOLETE', obsoleteAt: now },
      });
      await tx.engineeringDocument.update({
        where: { id: eco.engineeringDocumentId },
        data: { currentReleasedRevisionId: eco.targetRevisionId },
      });

      for (const impact of eco.impacts) {
        if (impact.decision === 'SWITCH_NEW') {
          const switched = await tx.workOrderEngineeringRevision.updateMany({
            where: {
              workOrderId: impact.workOrderId,
              engineeringRevisionId: eco.sourceRevisionId,
              companyId,
            },
            data: {
              engineeringRevisionId: eco.targetRevisionId,
              pinnedById: operatorId,
              createdAt: now,
            },
          });
          if (switched.count !== 1) {
            throw new ConflictException(
              `工单 ${impact.workOrderId} 的固定版本已变化`,
            );
          }
        }
      }
      await tx.engineeringChangeImpact.updateMany({
        where: { engineeringChangeOrderId: eco.id },
        data: { appliedAt: now },
      });
      await tx.engineeringChangeOrder.update({
        where: { id: eco.id },
        data: {
          status: 'APPROVED',
          approvedById: operatorId,
          approvedAt: now,
          approvalComment: data.comment?.trim() || null,
        },
      });
      await this.writeAudit(tx, companyId, operatorId, eco.id, 'ECO_APPROVED', {
        sourceRevisionId: eco.sourceRevisionId,
        targetRevisionId: eco.targetRevisionId,
        impacts: eco.impacts.map((impact) => ({
          workOrderId: impact.workOrderId,
          decision: impact.decision,
        })),
      });
      return { id: eco.id, status: 'APPROVED' };
    });
  }

  private async readChangeContext(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    documentId: string,
    targetRevisionId: string,
  ) {
    const document = await tx.engineeringDocument.findFirst({
      where: { id: documentId, companyId },
      include: {
        currentReleasedRevision: true,
        revisions: { where: { id: targetRevisionId } },
      },
    });
    if (!document) throw new NotFoundException('工程文档不存在或无权访问');
    if (!document.currentReleasedRevision) {
      throw new BadRequestException('首个发布版本不需要工程变更单');
    }
    const targetRevision = document.revisions[0];
    if (!targetRevision || targetRevision.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('目标版本必须属于当前文档且处于待批准状态');
    }
    return {
      document: {
        id: document.id,
        documentNo: document.documentNo,
        title: document.title,
      },
      sourceRevision: document.currentReleasedRevision,
      targetRevision,
    };
  }

  private findAffectedWorkOrders(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    sourceRevisionId: string,
  ) {
    return tx.workOrder.findMany({
      where: {
        companyId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        engineeringRevisionPins: {
          some: { engineeringRevisionId: sourceRevisionId },
        },
      },
      orderBy: { workOrderNo: 'asc' },
      select: {
        id: true,
        workOrderNo: true,
        status: true,
        plannedQty: true,
        actualQty: true,
        product: { select: { id: true, sku: true, name: true } },
        order: { select: { id: true, orderNo: true } },
      },
    });
  }

  private validateImpactCoverage(
    affected: Array<{ id: string }>,
    impacts: EngineeringChangeImpactDto[],
  ) {
    const affectedIds = new Set(affected.map((workOrder) => workOrder.id));
    const impactIds = new Set(impacts.map((impact) => impact.workOrderId));
    if (
      affectedIds.size !== impactIds.size ||
      [...affectedIds].some((id) => !impactIds.has(id))
    ) {
      throw new BadRequestException(
        '工程变更单必须覆盖全部且仅覆盖受影响的在制工单',
      );
    }
    for (const impact of impacts) {
      if (
        ['CONTINUE_OLD', 'SCRAP_REWORK'].includes(impact.decision) &&
        !impact.note?.trim()
      ) {
        throw new BadRequestException('继续旧版或报废返工必须填写处置说明');
      }
    }
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    companyId: string,
    operatorId: string,
    ecoId: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        companyId,
        userId: operatorId,
        entity: 'engineeringChangeOrder',
        entityId: ecoId,
        action,
        details: details as Prisma.InputJsonValue,
      },
    });
  }

  private include() {
    return {
      engineeringDocument: {
        select: { id: true, documentNo: true, title: true },
      },
      sourceRevision: { include: { fileRecord: true } },
      targetRevision: { include: { fileRecord: true } },
      creator: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true } },
      impacts: {
        orderBy: { createdAt: 'asc' as const },
        include: {
          workOrder: {
            include: {
              product: { select: { id: true, sku: true, name: true } },
              order: { select: { id: true, orderNo: true } },
            },
          },
        },
      },
    };
  }
}
