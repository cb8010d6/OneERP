import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { ListRequirementsDto } from './dto/list-requirements.dto';
import { AddFollowUpDto } from './dto/add-follow-up.dto';
import { CloseRequirementDto } from './dto/close-requirement.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { CreateQuoteVersionDto } from './dto/create-quote-version.dto';

const REQUIREMENT_DOCUMENT_TYPE = 'CUSTOMER_REQUIREMENT';
const QUOTE_DOCUMENT_TYPE = 'QUOTE';

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
          quotes: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              quoteNo: true,
              currentVersionNo: true,
              versions: {
                take: 1,
                orderBy: { versionNo: 'desc' },
                select: {
                  id: true,
                  versionNo: true,
                  status: true,
                  currencyCode: true,
                  total: true,
                  validUntil: true,
                },
              },
            },
          },
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

  async createQuoteFromRequirement(
    companyId: string,
    operatorId: string,
    requirementId: string,
    data: CreateQuoteDto,
  ) {
    const currencyCode = data.currencyCode.trim().toUpperCase();
    if (currencyCode !== 'CNY') {
      throw new BadRequestException('非 CNY 报价需配置汇率服务后才能创建');
    }

    const now = new Date();
    const validUntil = new Date(data.validUntil);
    if (validUntil <= now) {
      throw new BadRequestException('报价有效期必须晚于当前时间');
    }
    if (
      new Set(data.items.map((item) => item.productId)).size !==
      data.items.length
    ) {
      throw new BadRequestException('同一产品不能在报价明细中重复出现');
    }
    const year = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
      }).format(now),
    );

    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.customerRequirement.findFirst({
        where: { id: requirementId, companyId },
        select: {
          id: true,
          partnerId: true,
          ownerId: true,
          status: true,
        },
      });
      if (!requirement) {
        throw new NotFoundException('客户需求单不存在或无权访问');
      }
      if (['LOST', 'CANCELLED', 'CONVERTED'].includes(requirement.status)) {
        throw new BadRequestException('已关闭的客户需求单不能创建报价');
      }
      const existingQuote = await tx.quote.findFirst({
        where: { companyId, requirementId: requirement.id },
        select: { id: true },
      });
      if (existingQuote) {
        throw new BadRequestException(
          '该客户需求单已经创建报价，请新增报价版本',
        );
      }

      const products = await tx.product.findMany({
        where: {
          companyId,
          isActive: true,
          id: { in: data.items.map((item) => item.productId) },
        },
        select: { id: true, sku: true, name: true, uom: true, listPrice: true },
      });
      if (products.length !== data.items.length) {
        throw new BadRequestException('报价包含不存在、已停用或跨公司的产品');
      }
      const productsById = new Map(
        products.map((product) => [product.id, product]),
      );

      let subtotal = new Prisma.Decimal(0);
      let taxTotal = new Prisma.Decimal(0);
      const items = data.items.map((item) => {
        const product = productsById.get(item.productId)!;
        const quantity = new Prisma.Decimal(item.quantity);
        const unitPrice = new Prisma.Decimal(item.unitPrice);
        const discountRate = new Prisma.Decimal(item.discountRate ?? 0);
        const taxRate = new Prisma.Decimal(item.taxRate ?? 0);
        const netAmount = quantity
          .mul(unitPrice)
          .mul(new Prisma.Decimal(1).minus(discountRate))
          .toDecimalPlaces(4);
        const taxAmount = netAmount.mul(taxRate).toDecimalPlaces(4);
        const grossAmount = netAmount.plus(taxAmount).toDecimalPlaces(4);
        subtotal = subtotal.plus(netAmount);
        taxTotal = taxTotal.plus(taxAmount);
        return {
          companyId,
          productId: product.id,
          skuSnapshot: product.sku,
          nameSnapshot: product.name,
          uomSnapshot: product.uom,
          quantity,
          unitPrice,
          discountRate,
          taxRate,
          netAmount,
          taxAmount,
          grossAmount,
        };
      });

      const sequence = await tx.documentSequence.upsert({
        where: {
          companyId_documentType_year: {
            companyId,
            documentType: QUOTE_DOCUMENT_TYPE,
            year,
          },
        },
        create: {
          companyId,
          documentType: QUOTE_DOCUMENT_TYPE,
          year,
          lastValue: 1,
        },
        update: { lastValue: { increment: 1 } },
        select: { lastValue: true },
      });
      const quoteNo = `QT-${year}-${String(sequence.lastValue).padStart(6, '0')}`;

      const quote = await tx.quote.create({
        data: {
          quoteNo,
          companyId,
          requirementId: requirement.id,
          partnerId: requirement.partnerId,
          ownerId: requirement.ownerId,
          currentVersionNo: 1,
          versions: {
            create: {
              companyId,
              versionNo: 1,
              status: 'DRAFT',
              currencyCode,
              baseCurrencyCode: 'CNY',
              exchangeRate: new Prisma.Decimal(1),
              exchangeRateAt: now,
              exchangeRateSource: 'SYSTEM_BASE',
              validUntil,
              paymentTerms: data.paymentTerms?.trim() || null,
              deliveryTerms: data.deliveryTerms?.trim() || null,
              subtotal: subtotal.toDecimalPlaces(4),
              taxTotal: taxTotal.toDecimalPlaces(4),
              total: subtotal.plus(taxTotal).toDecimalPlaces(4),
              items: { create: items },
            },
          },
        },
        include: { versions: { include: { items: true } } },
      });

      await tx.customerRequirement.update({
        where: { id: requirement.id },
        data: { status: 'QUOTING' },
      });
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'quote',
          entityId: quote.id,
          action: 'QUOTE_V1_CREATED',
          details: { quoteNo, requirementId, versionNo: 1, currencyCode },
        },
      });

      return quote;
    });
  }

  async createQuoteVersion(
    companyId: string,
    operatorId: string,
    quoteId: string,
    data: CreateQuoteVersionDto = {},
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, companyId },
        select: {
          id: true,
          currentVersionNo: true,
          versions: {
            take: 1,
            orderBy: { versionNo: 'desc' },
            include: { items: true },
          },
        },
      });
      if (!quote) {
        throw new NotFoundException('报价不存在或无权访问');
      }
      const currentVersion = quote.versions[0];
      if (
        !currentVersion ||
        currentVersion.versionNo !== quote.currentVersionNo
      ) {
        throw new BadRequestException('报价当前版本数据不完整');
      }
      if (currentVersion.status === 'DRAFT') {
        throw new BadRequestException('当前版本仍是草稿，请直接编辑该版本');
      }
      if (currentVersion.status === 'ACCEPTED') {
        throw new BadRequestException('已接受的报价不能创建新版本');
      }

      const requestedValidUntil = data.validUntil
        ? new Date(data.validUntil)
        : null;
      const fallbackValidUntil = new Date(now);
      fallbackValidUntil.setDate(fallbackValidUntil.getDate() + 14);
      const validUntil =
        requestedValidUntil ??
        (currentVersion.validUntil > now
          ? currentVersion.validUntil
          : fallbackValidUntil);
      if (validUntil <= now) {
        throw new BadRequestException('新版本有效期必须晚于当前时间');
      }

      const versionNo = quote.currentVersionNo + 1;
      const claimed = await tx.quote.updateMany({
        where: {
          id: quote.id,
          companyId,
          currentVersionNo: quote.currentVersionNo,
        },
        data: { currentVersionNo: versionNo },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('报价当前版本已变化，请刷新后重试');
      }
      const version = await tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          companyId,
          versionNo,
          status: 'DRAFT',
          currencyCode: currentVersion.currencyCode,
          baseCurrencyCode: currentVersion.baseCurrencyCode,
          exchangeRate: currentVersion.exchangeRate,
          exchangeRateAt: currentVersion.exchangeRateAt,
          exchangeRateSource: currentVersion.exchangeRateSource,
          validUntil,
          paymentTerms: currentVersion.paymentTerms,
          deliveryTerms: currentVersion.deliveryTerms,
          subtotal: currentVersion.subtotal,
          taxTotal: currentVersion.taxTotal,
          total: currentVersion.total,
          items: {
            create: currentVersion.items.map((item) => ({
              companyId,
              productId: item.productId,
              skuSnapshot: item.skuSnapshot,
              nameSnapshot: item.nameSnapshot,
              uomSnapshot: item.uomSnapshot,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountRate: item.discountRate,
              taxRate: item.taxRate,
              netAmount: item.netAmount,
              taxAmount: item.taxAmount,
              grossAmount: item.grossAmount,
            })),
          },
        },
        include: { items: true },
      });
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'quote',
          entityId: quote.id,
          action: 'QUOTE_VERSION_CREATED',
          details: { fromVersionNo: currentVersion.versionNo, versionNo },
        },
      });
      return version;
    });
  }

  async sendQuoteVersion(
    companyId: string,
    operatorId: string,
    versionId: string,
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.quoteVersion.findFirst({
        where: { id: versionId, companyId },
        include: { quote: { select: { currentVersionNo: true } }, items: true },
      });
      if (!version) throw new NotFoundException('报价版本不存在或无权访问');
      if (version.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿报价版本可以发出');
      }
      if (version.versionNo !== version.quote.currentVersionNo) {
        throw new BadRequestException('只能发出当前报价版本');
      }
      if (!version.items.length)
        throw new BadRequestException('报价明细不能为空');
      if (version.validUntil <= now)
        throw new BadRequestException('报价已过有效期');

      const sent = await tx.quoteVersion.updateMany({
        where: { id: version.id, companyId, status: 'DRAFT' },
        data: { status: 'SENT', sentAt: now },
      });
      if (sent.count !== 1) {
        throw new ConflictException('报价版本状态已变化，请刷新后重试');
      }
      if (version.versionNo > 1) {
        await tx.quoteVersion.updateMany({
          where: {
            quoteId: version.quoteId,
            companyId,
            status: 'SENT',
            versionNo: { lt: version.versionNo },
          },
          data: { status: 'SUPERSEDED' },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'quoteVersion',
          entityId: version.id,
          action: 'QUOTE_SENT',
          details: { quoteId: version.quoteId, versionNo: version.versionNo },
        },
      });
      return tx.quoteVersion.findFirst({
        where: { id: version.id, companyId },
        include: { items: true },
      });
    });
  }

  async recordQuoteDecision(
    companyId: string,
    operatorId: string,
    versionId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.quoteVersion.findFirst({
        where: { id: versionId, companyId },
        select: { id: true, quoteId: true, versionNo: true, status: true },
      });
      if (!version) throw new NotFoundException('报价版本不存在或无权访问');
      if (version.status !== 'SENT') {
        throw new BadRequestException('只有已发出的报价可以记录客户决策');
      }
      const updated = await tx.quoteVersion.updateMany({
        where: { id: version.id, companyId, status: 'SENT' },
        data: {
          status: decision,
          acceptedAt: decision === 'ACCEPTED' ? now : null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('报价版本状态已变化，请刷新后重试');
      }
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          companyId,
          entity: 'quoteVersion',
          entityId: version.id,
          action: 'QUOTE_CUSTOMER_DECISION_RECORDED',
          details: {
            quoteId: version.quoteId,
            versionNo: version.versionNo,
            decision,
          },
        },
      });
      return tx.quoteVersion.findFirst({
        where: { id: version.id, companyId },
        include: { items: true },
      });
    });
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
