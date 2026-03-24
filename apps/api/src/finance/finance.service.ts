import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntryPostingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, CreatePaymentDto } from './dto/finance.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createInvoice(
    companyId: string,
    dto: CreateInvoiceDto,
    operatorId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, companyId },
    });
    if (!order) throw new NotFoundException('找不到销售订单');

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNo: `INV-${Date.now()}`,
        orderId: dto.orderId,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        status: 'UNPAID',
        postingStatus: EntryPostingStatus.DRAFT,
        companyId,
      },
    });

    // 记录审计日志
    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'CREATE_INVOICE',
        entity: 'Invoice',
        entityId: invoice.id,
        details: { amount: dto.amount, orderId: dto.orderId },
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
        include: { order: true, payments: true },
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

  async postInvoice(
    companyId: string,
    invoiceId: string,
    operatorId: string,
    taxRate?: number,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
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

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        postingStatus: EntryPostingStatus.POSTED,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_INVOICE',
        entity: 'invoice',
        entityId: invoice.id,
        details: { invoiceNo: invoice.invoiceNo, taxRate: taxRate ?? 0.13 },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.invoice.posted', {
      companyId,
      invoiceId: invoice.id,
      taxRate: taxRate ?? 0.13,
      operatorId,
    });

    return updated;
  }
}
