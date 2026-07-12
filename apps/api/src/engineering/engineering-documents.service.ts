import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddEngineeringRevisionDto,
  CreateEngineeringDocumentDto,
  ReviewEngineeringRevisionDto,
} from './dto/engineering-documents.dto';

const ENGINEERING_DOCUMENT_SEQUENCE = 'ENGINEERING_DOCUMENT';

@Injectable()
export class EngineeringDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, search?: string) {
    const normalizedSearch = search?.trim();
    return this.prisma.engineeringDocument.findMany({
      where: {
        companyId,
        ...(normalizedSearch
          ? {
              OR: [
                {
                  documentNo: {
                    contains: normalizedSearch,
                    mode: 'insensitive',
                  },
                },
                { title: { contains: normalizedSearch, mode: 'insensitive' } },
                {
                  externalNo: {
                    contains: normalizedSearch,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: this.documentInclude(),
    });
  }

  async listReleasedForOrder(companyId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, companyId },
      select: { id: true, items: { select: { productId: true } } },
    });
    if (!order) throw new NotFoundException('销售订单不存在或无权访问');
    const productIds = [...new Set(order.items.map((item) => item.productId))];
    return this.prisma.engineeringDocument.findMany({
      where: {
        companyId,
        currentReleasedRevisionId: { not: null },
        OR: [{ orderId: order.id }, { productId: { in: productIds } }],
      },
      orderBy: { documentNo: 'asc' },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        currentReleasedRevision: {
          include: { fileRecord: true },
        },
      },
    });
  }

  async createDocument(
    companyId: string,
    operatorId: string,
    data: CreateEngineeringDocumentDto,
  ) {
    if (!data.productId && !data.orderId) {
      throw new BadRequestException('工程文档必须关联产品或销售订单');
    }

    return this.prisma.$transaction(async (tx) => {
      const file = await this.readUsableFile(tx, companyId, data.fileRecordId);
      const product = data.productId
        ? await tx.product.findFirst({
            where: { id: data.productId, companyId },
            select: { id: true, sku: true },
          })
        : null;
      if (data.productId && !product) {
        throw new NotFoundException('关联产品不存在或无权访问');
      }
      const order = data.orderId
        ? await tx.order.findFirst({
            where: { id: data.orderId, companyId },
            select: { id: true, orderNo: true },
          })
        : null;
      if (data.orderId && !order) {
        throw new NotFoundException('关联订单不存在或无权访问');
      }

      const sequence = await tx.documentSequence.upsert({
        where: {
          companyId_documentType_year: {
            companyId,
            documentType: ENGINEERING_DOCUMENT_SEQUENCE,
            year: 0,
          },
        },
        create: {
          companyId,
          documentType: ENGINEERING_DOCUMENT_SEQUENCE,
          year: 0,
          lastValue: 1,
        },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });
      const reference = this.sanitizeReference(
        product?.sku ?? order?.orderNo ?? 'PROJECT',
      );
      const documentNo = `ED-${reference}-${String(sequence.lastValue).padStart(6, '0')}`;
      const document = await tx.engineeringDocument.create({
        data: {
          documentNo,
          title: data.title.trim(),
          documentType: data.documentType,
          externalNo: data.externalNo?.trim() || null,
          productId: product?.id,
          orderId: order?.id,
          currentRevisionNo: 1,
          companyId,
          createdById: operatorId,
          revisions: {
            create: {
              revisionNo: 1,
              status: 'DRAFT',
              fileRecordId: file.id,
              checksumSha256: file.checksumSha256,
              notes: data.notes?.trim() || null,
              createdById: operatorId,
              companyId,
            },
          },
        },
        include: this.documentInclude(),
      });
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        document.id,
        'ENGINEERING_DOCUMENT_CREATED',
        {
          documentNo,
          revisionNo: 1,
          fileRecordId: file.id,
        },
      );
      return document;
    });
  }

  async addRevision(
    companyId: string,
    operatorId: string,
    documentId: string,
    data: AddEngineeringRevisionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.engineeringDocument.findFirst({
        where: { id: documentId, companyId },
        include: { revisions: { orderBy: { revisionNo: 'desc' }, take: 1 } },
      });
      if (!document) throw new NotFoundException('工程文档不存在或无权访问');
      const latest = document.revisions[0];
      if (
        latest &&
        !['RELEASED', 'OBSOLETE', 'CHANGES_REQUESTED'].includes(latest.status)
      ) {
        throw new ConflictException('当前版本尚未结束，不能创建新版本');
      }
      const file = await this.readUsableFile(tx, companyId, data.fileRecordId);
      const revisionNo = document.currentRevisionNo + 1;
      const claimed = await tx.engineeringDocument.updateMany({
        where: {
          id: document.id,
          companyId,
          currentRevisionNo: document.currentRevisionNo,
        },
        data: { currentRevisionNo: revisionNo },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('工程文档已产生新版本，请刷新后重试');
      }
      const revision = await tx.engineeringDocumentRevision.create({
        data: {
          engineeringDocumentId: document.id,
          revisionNo,
          status: 'DRAFT',
          fileRecordId: file.id,
          checksumSha256: file.checksumSha256,
          notes: data.notes?.trim() || null,
          createdById: operatorId,
          companyId,
        },
        include: {
          fileRecord: true,
          creator: { select: { id: true, name: true } },
        },
      });
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        document.id,
        'ENGINEERING_REVISION_CREATED',
        {
          revisionId: revision.id,
          revisionNo,
          fileRecordId: file.id,
        },
      );
      return revision;
    });
  }

  async submitRevision(
    companyId: string,
    operatorId: string,
    revisionId: string,
  ) {
    return this.transitionRevision(
      companyId,
      operatorId,
      revisionId,
      'DRAFT',
      'PENDING_REVIEW',
      'ENGINEERING_REVISION_SUBMITTED',
      { submittedAt: new Date() },
    );
  }

  async reviewRevision(
    companyId: string,
    operatorId: string,
    revisionId: string,
    data: ReviewEngineeringRevisionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const revision = await this.readRevision(tx, companyId, revisionId);
      if (revision.status !== 'PENDING_REVIEW') {
        throw new ConflictException('当前版本不在待校审状态');
      }
      if (revision.createdById === operatorId) {
        throw new BadRequestException('设计人员不能校审自己上传的版本');
      }
      if (data.decision === 'REQUEST_CHANGES' && !data.comment?.trim()) {
        throw new BadRequestException('退回修改必须填写意见');
      }
      const status =
        data.decision === 'APPROVE' ? 'PENDING_APPROVAL' : 'CHANGES_REQUESTED';
      const changed = await tx.engineeringDocumentRevision.updateMany({
        where: { id: revision.id, status: 'PENDING_REVIEW' },
        data: {
          status,
          reviewedById: operatorId,
          reviewedAt: new Date(),
          reviewComment: data.comment?.trim() || null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('版本状态已变化，请刷新后重试');
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        revision.engineeringDocument.id,
        'ENGINEERING_REVISION_REVIEWED',
        {
          revisionId,
          decision: data.decision,
          status,
        },
      );
      return { id: revision.id, status };
    });
  }

  async releaseRevision(
    companyId: string,
    operatorId: string,
    revisionId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const revision = await this.readRevision(tx, companyId, revisionId);
      if (revision.status !== 'PENDING_APPROVAL') {
        throw new ConflictException('当前版本不在待批准状态');
      }
      if (
        operatorId === revision.createdById ||
        operatorId === revision.reviewedById
      ) {
        throw new BadRequestException('批准人必须与设计人、校审人不同');
      }
      const now = new Date();
      const changed = await tx.engineeringDocumentRevision.updateMany({
        where: { id: revision.id, status: 'PENDING_APPROVAL' },
        data: {
          status: 'RELEASED',
          approvedById: operatorId,
          approvedAt: now,
          releasedAt: now,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('版本状态已变化，请刷新后重试');
      await tx.engineeringDocumentRevision.updateMany({
        where: {
          engineeringDocumentId: revision.engineeringDocument.id,
          status: 'RELEASED',
          id: { not: revision.id },
        },
        data: { status: 'OBSOLETE', obsoleteAt: now },
      });
      const document = await tx.engineeringDocument.update({
        where: { id: revision.engineeringDocument.id },
        data: { currentReleasedRevisionId: revision.id },
      });
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        document.id,
        'ENGINEERING_REVISION_RELEASED',
        {
          revisionId,
          revisionNo: revision.revisionNo,
        },
      );
      return document;
    });
  }

  private async transitionRevision(
    companyId: string,
    operatorId: string,
    revisionId: string,
    fromStatus: string,
    toStatus: string,
    action: string,
    extraData: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const revision = await this.readRevision(tx, companyId, revisionId);
      if (revision.status !== fromStatus)
        throw new ConflictException('当前版本状态不允许此操作');
      if (fromStatus === 'DRAFT' && revision.createdById !== operatorId) {
        throw new BadRequestException('只有版本设计人可以提交校审');
      }
      const changed = await tx.engineeringDocumentRevision.updateMany({
        where: { id: revision.id, status: fromStatus },
        data: { status: toStatus, ...extraData },
      });
      if (changed.count !== 1)
        throw new ConflictException('版本状态已变化，请刷新后重试');
      await this.writeAudit(
        tx,
        companyId,
        operatorId,
        revision.engineeringDocument.id,
        action,
        {
          revisionId,
          fromStatus,
          toStatus,
        },
      );
      return { id: revision.id, status: toStatus };
    });
  }

  private async readUsableFile(
    tx: Prisma.TransactionClient,
    companyId: string,
    fileRecordId: string,
  ) {
    const file = await tx.fileRecord.findFirst({
      where: { id: fileRecordId, companyId, engineeringDocumentRevision: null },
      select: {
        id: true,
        companyId: true,
        checksumSha256: true,
        fileName: true,
        mimeType: true,
      },
    });
    if (!file) throw new NotFoundException('文件不存在、已被使用或无权访问');
    if (!file.checksumSha256) {
      throw new BadRequestException('旧文件缺少校验值，请重新上传后关联');
    }
    return { ...file, checksumSha256: file.checksumSha256 };
  }

  private async readRevision(
    tx: Prisma.TransactionClient,
    companyId: string,
    revisionId: string,
  ) {
    const revision = await tx.engineeringDocumentRevision.findFirst({
      where: { id: revisionId, companyId },
      include: {
        engineeringDocument: { select: { id: true, companyId: true } },
      },
    });
    if (!revision) throw new NotFoundException('工程版本不存在或无权访问');
    return revision;
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    companyId: string,
    operatorId: string,
    documentId: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        companyId,
        userId: operatorId,
        entity: 'engineeringDocument',
        entityId: documentId,
        action,
        details: details as Prisma.InputJsonValue,
      },
    });
  }

  private sanitizeReference(value: string) {
    return (
      value
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 16)
        .toUpperCase() || 'PROJECT'
    );
  }

  private documentInclude() {
    return {
      product: { select: { id: true, sku: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      creator: { select: { id: true, name: true } },
      currentReleasedRevision: {
        include: { fileRecord: true },
      },
      revisions: {
        orderBy: { revisionNo: 'desc' as const },
        include: {
          fileRecord: true,
          creator: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
        },
      },
    };
  }
}
