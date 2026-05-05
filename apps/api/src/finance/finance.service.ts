import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntryPostingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaxService } from '../core/tax/tax.service';
import { CreateInvoiceDto, CreatePaymentDto } from './dto/finance.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly taxService: TaxService,
  ) {}

  async createInvoice(
    companyId: string,
    dto: CreateInvoiceDto,
    operatorId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
      select: { id: true, taxCodeId: true },
    });
    if (!order) throw new NotFoundException('找不到销售订单');

    const resolvedTaxCode = await this.taxService.resolveTaxCode(
      companyId,
      dto.taxCodeId ?? order.taxCodeId,
      { operatorId, entity: 'Invoice', entityId: 'new' },
    );

    const amount = this.taxService.round2(Number(dto.amount));
    const breakdown = this.taxService.calcTaxFromTotal(
      amount,
      resolvedTaxCode.rate,
      resolvedTaxCode.taxNature,
    );

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNo: 'INV-' + Date.now(),
        orderId: dto.orderId,
        amount,
        subTotal: breakdown.subTotal,
        taxAmount: breakdown.taxAmount,
        taxRate: breakdown.taxRate,
        taxNature: breakdown.taxNature,
        taxCodeId: resolvedTaxCode.id ?? null,
        dueDate: new Date(dto.dueDate),
        status: 'UNPAID',
        postingStatus: EntryPostingStatus.DRAFT,
        companyId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'CREATE_INVOICE',
        entity: 'Invoice',
        entityId: invoice.id,
        details: {
          amount,
          orderId: dto.orderId,
          taxCodeId: resolvedTaxCode.id ?? null,
          taxRate: breakdown.taxRate,
          taxNature: breakdown.taxNature,
          subTotal: breakdown.subTotal,
          taxAmount: breakdown.taxAmount,
          taxFallback: resolvedTaxCode.isFallback,
        },
        companyId,
      },
    });

    return invoice;
  }

  async getInvoices(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { order: true, payments: true, taxCode: true },
        orderBy: { issuedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: CreatePaymentDto,
  ) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { payments: true },
    });
    if (!inv) throw new NotFoundException('发票不存在');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          method: dto.method,
        },
      });

      const totalPaid =
        inv.payments.reduce((sum, p) => sum + p.amount, 0) + dto.amount;

      let newStatus = inv.status;
      if (totalPaid >= inv.amount) newStatus = 'PAID';
      else if (totalPaid > 0) newStatus = 'PARTIAL';

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      });

      return payment;
    });
  }

  /**
   * 过账发票 — 使用保存在发票上的价税快照，禁止重新按当前税率覆盖历史金额。
   * 只有在 subTotal/taxAmount 均为 0 的历史遗留数据上才做一次性的兜底计算。
   */
  async postInvoice(companyId: string, invoiceId: string, operatorId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        order: { select: { taxCodeId: true } },
        taxCode: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('发票不存在');
    }

    if (invoice.postingStatus === EntryPostingStatus.POSTED) {
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        postingStatus: invoice.postingStatus,
        message: '发票已过账，无需重复处理',
      };
    }

    const amount = this.taxService.round2(Number(invoice.amount));
    let subTotal = this.taxService.round2(Number(invoice.subTotal ?? 0));
    let taxAmount = this.taxService.round2(Number(invoice.taxAmount ?? 0));
    const shouldRecalc = subTotal <= 0 && taxAmount <= 0 && amount > 0;

    if (shouldRecalc) {
      const fallbackRate =
        Number(invoice.taxRate) > 0
          ? Number(invoice.taxRate)
          : Number(invoice.taxCode?.rate ?? 0.13);
      const breakdown = this.taxService.calcTaxFromTotal(
        amount,
        fallbackRate,
        invoice.taxNature,
      );
      subTotal = breakdown.subTotal;
      taxAmount = breakdown.taxAmount;
      this.logger.warn(
        '发票缺少价税快照，过账时兜底计算: invoiceNo=' +
          invoice.invoiceNo +
          ' rate=' +
          fallbackRate,
      );
    }

    const updateData: Prisma.InvoiceUpdateInput = {
      postingStatus: EntryPostingStatus.POSTED,
    };
    if (shouldRecalc) {
      updateData.subTotal = subTotal;
      updateData.taxAmount = taxAmount;
    }
    if (!invoice.taxCodeId && invoice.order?.taxCodeId) {
      updateData.taxCode = { connect: { id: invoice.order.taxCodeId } };
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: updateData,
    });

    const taxCodeId = invoice.taxCodeId ?? invoice.order?.taxCodeId ?? null;
    let taxAccountId: string | null = null;
    if (taxCodeId) {
      const resolved = await this.taxService.resolveTaxCode(
        companyId,
        taxCodeId,
      );
      taxAccountId = this.taxService.getTaxAccountId(resolved);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_INVOICE',
        entity: 'invoice',
        entityId: invoice.id,
        details: {
          invoiceNo: invoice.invoiceNo,
          taxCodeId,
          taxRate: invoice.taxRate ?? 0.13,
          taxNature: invoice.taxNature,
          taxAccountId,
          usedSnapshot: !shouldRecalc,
        },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.invoice.posted', {
      companyId,
      idempotencyKey: 'invoice_posted:' + invoice.id,
      invoiceId: invoice.id,
      taxCodeId,
      taxAccountId,
      taxRate: invoice.taxRate ?? 0.13,
      operatorId,
    });

    return updated;
  }
}
