import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { ListRequirementsDto } from './dto/list-requirements.dto';
import { AddFollowUpDto } from './dto/add-follow-up.dto';
import { CloseRequirementDto } from './dto/close-requirement.dto';

const REQUIREMENT_DOCUMENT_TYPE = 'CUSTOMER_REQUIREMENT';

@Injectable()
export class PresalesService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequirement(
    companyId: string,
    ownerId: string,
    data: CreateRequirementDto,
  ) {
    const now = new Date();
    const year = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
      }).format(now),
    );

    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findFirst({
        where: {
          id: data.partnerId,
          companyId,
          isActive: true,
          type: { in: ['CUSTOMER', 'BOTH'] },
        },
        select: { id: true, name: true, type: true },
      });
      if (!partner) {
        throw new BadRequestException('客户不存在、已停用或不属于当前公司');
      }

      const sequence = await tx.documentSequence.upsert({
        where: {
          companyId_documentType_year: {
            companyId,
            documentType: REQUIREMENT_DOCUMENT_TYPE,
            year,
          },
        },
        create: {
          companyId,
          documentType: REQUIREMENT_DOCUMENT_TYPE,
          year,
          lastValue: 1,
        },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });
      const requirementNo = `REQ-${year}-${String(sequence.lastValue).padStart(6, '0')}`;

      const requirement = await tx.customerRequirement.create({
        data: {
          requirementNo,
          companyId,
          partnerId: partner.id,
          ownerId,
          status: 'DRAFT',
          sourceChannel: data.sourceChannel.trim(),
          summary: data.summary.trim(),
          estimatedAmount:
            data.estimatedAmount === undefined
              ? null
              : new Prisma.Decimal(data.estimatedAmount),
          expectedCloseDate: data.expectedCloseDate
            ? new Date(data.expectedCloseDate)
            : null,
          nextFollowUpAt: data.nextFollowUpAt
            ? new Date(data.nextFollowUpAt)
            : null,
        },
        include: {
          partner: { select: { id: true, name: true, code: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: ownerId,
          companyId,
          entity: 'customerRequirement',
          entityId: requirement.id,
          action: 'REQUIREMENT_CREATED',
          details: {
            requirementNo,
            partnerId: partner.id,
            sourceChannel: data.sourceChannel.trim(),
          },
        },
      });

      return requirement;
    });
  }

  async listRequirements(companyId: string, query: ListRequirementsDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const search = query.search?.trim();
    const status = query.status?.trim();
    const where: Prisma.CustomerRequirementWhereInput = {
      companyId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { requirementNo: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
              {
                partner: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.customerRequirement.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true, code: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { requirementNo: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerRequirement.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async addFollowUp(
    companyId: string,
    operatorId: string,
    requirementId: string,
    data: AddFollowUpDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.customerRequirement.findFirst({
        where: { id: requirementId, companyId },
        select: { id: true, status: true },
      });
      if (!requirement) {
        throw new NotFoundException('客户需求单不存在或无权访问');
      }
      if (['LOST', 'CANCELLED', 'CONVERTED'].includes(requirement.status)) {
        throw new BadRequestException('终态客户需求单不能继续跟进');
      }

      const nextFollowUpAt = data.nextFollowUpAt
        ? new Date(data.nextFollowUpAt)
        : null;
      const activity = await tx.requirementActivity.create({
        data: {
          requirementId,
          companyId,
          activityType: 'FOLLOW_UP',
          content: data.content.trim(),
          nextFollowUpAt,
          createdById: operatorId,
        },
      });
      const updatedRequirement = await tx.customerRequirement.update({
        where: { id: requirementId },
        data: {
          status: requirement.status === 'DRAFT' ? 'FOLLOWING' : undefined,
          nextFollowUpAt,
        },
        include: {
          partner: { select: { id: true, name: true, code: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'customerRequirement',
          entityId: requirementId,
          action: 'REQUIREMENT_FOLLOW_UP_ADDED',
          details: {
            activityId: activity.id,
            nextFollowUpAt: data.nextFollowUpAt ?? null,
          },
        },
      });

      return { requirement: updatedRequirement, activity };
    });
  }

  async closeRequirement(
    companyId: string,
    operatorId: string,
    requirementId: string,
    data: CloseRequirementDto,
  ) {
    if (data.status === 'LOST' && !data.reason?.trim()) {
      throw new BadRequestException('标记丢单时必须填写关闭原因');
    }

    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.customerRequirement.findFirst({
        where: { id: requirementId, companyId },
        select: { id: true, status: true },
      });
      if (!requirement) {
        throw new NotFoundException('客户需求单不存在或无权访问');
      }
      if (['LOST', 'CANCELLED', 'CONVERTED'].includes(requirement.status)) {
        throw new BadRequestException('客户需求单已关闭，不能重复操作');
      }

      const closeReason = data.reason?.trim() || null;
      const updatedRequirement = await tx.customerRequirement.update({
        where: { id: requirementId },
        data: {
          status: data.status,
          closeReason,
          nextFollowUpAt: null,
        },
        include: {
          partner: { select: { id: true, name: true, code: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'customerRequirement',
          entityId: requirementId,
          action: 'REQUIREMENT_CLOSED',
          details: {
            from: requirement.status,
            to: data.status,
            reason: closeReason,
          },
        },
      });

      return updatedRequirement;
    });
  }
}
