import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { roundDecimal } from '../core/utils/decimal';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { UnappliedPaymentRow } from './finance.types';

@Injectable()
export class FinanceQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getInvoices(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          order: true,
          payments: true,
          paymentAllocations: true,
          creditNotes: true,
        },
        orderBy: { issuedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUnappliedPayments(
    companyId: string,
  ): Promise<{ rows: UnappliedPaymentRow[] }> {
    const payments = await this.prisma.payment.findMany({
      where: { companyId },
      include: {
        partner: { select: { id: true, name: true } },
        allocations: { select: { amount: true } },
      },
      orderBy: { paymentDate: 'desc' },
      take: 100,
    });

    const rows = payments
      .map((payment) => {
        const amount = roundDecimal(Number(payment.amount));
        const allocatedAmount = roundDecimal(
          payment.allocations.reduce(
            (sum, allocation) => sum + Number(allocation.amount),
            0,
          ),
        );
        return {
          paymentId: payment.id,
          partnerId: payment.partner.id,
          partnerName: payment.partner.name,
          paymentDate: payment.paymentDate.toISOString(),
          method: payment.method,
          amount,
          allocatedAmount,
          unappliedAmount: roundDecimal(amount - allocatedAmount),
          postingStatus: payment.postingStatus,
        };
      })
      .filter((payment) => payment.unappliedAmount > 0)
      .sort((a, b) => b.unappliedAmount - a.unappliedAmount);

    return { rows };
  }

  async getCreditNotes(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.creditNote.findMany({
        where,
        include: {
          invoice: {
            include: {
              order: { select: { orderNo: true } },
            },
          },
          partner: { select: { id: true, name: true } },
          inventoryReturnDocument: {
            select: {
              id: true,
              returnNo: true,
              returnType: true,
              sourceDocumentNo: true,
            },
          },
          refunds: true,
        },
        orderBy: { creditDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.creditNote.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCustomerRefunds(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.customerRefund.findMany({
        where,
        include: {
          creditNote: { select: { creditNo: true } },
          partner: { select: { id: true, name: true } },
        },
        orderBy: { refundDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerRefund.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
