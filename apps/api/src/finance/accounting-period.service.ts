import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountingPeriodStatus, EntryPostingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAccountingPeriodDto } from './dto/accounting-period.dto';

type CloseBlockerCounts = {
  invoices: number;
  customerPayments: number;
  creditNotes: number;
  customerRefunds: number;
  purchaseInvoices: number;
  supplierCreditNotes: number;
  supplierPayments: number;
  financeEvents: number;
};

@Injectable()
export class AccountingPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, status?: AccountingPeriodStatus) {
    const periods = await this.prisma.accountingPeriod.findMany({
      where: {
        companyId,
        status,
      },
      orderBy: { startDate: 'desc' },
    });
    return Promise.all(
      periods.map(async (period) => {
        const closeBlockers = await this.getCloseBlockers(
          companyId,
          period.startDate,
          period.endDate,
        );
        return {
          ...period,
          closeBlockers,
          closeBlockerTotal: this.totalCloseBlockers(closeBlockers),
        };
      }),
    );
  }

  async upsert(companyId: string, dto: UpsertAccountingPeriodDto) {
    const periodKey = dto.periodKey.trim();
    if (!periodKey) {
      throw new BadRequestException('期间编号不能为空');
    }

    const startDate = this.parseDate(dto.startDate, '期间开始日期无效');
    const endDate = this.parseDate(dto.endDate, '期间结束日期无效');
    if (startDate > endDate) {
      throw new BadRequestException('期间开始日期不能晚于结束日期');
    }

    const overlapping = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        periodKey: { not: periodKey },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { periodKey: true },
    });
    if (overlapping) {
      throw new BadRequestException(
        `会计期间与 ${overlapping.periodKey} 日期范围重叠`,
      );
    }

    return this.prisma.accountingPeriod.upsert({
      where: { companyId_periodKey: { companyId, periodKey } },
      update: {
        startDate,
        endDate,
      },
      create: {
        companyId,
        periodKey,
        startDate,
        endDate,
        status: AccountingPeriodStatus.OPEN,
      },
    });
  }

  async close(companyId: string, periodKey: string, operatorId?: string) {
    const period = await this.findByKey(companyId, periodKey);
    if (period.status === AccountingPeriodStatus.CLOSED) {
      return period;
    }
    const blockers = await this.getCloseBlockers(
      companyId,
      period.startDate,
      period.endDate,
    );
    const totalBlockers = this.totalCloseBlockers(blockers);
    if (totalBlockers > 0) {
      throw new BadRequestException(this.formatCloseBlockerMessage(blockers));
    }

    return this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: AccountingPeriodStatus.CLOSED,
        closedAt: new Date(),
        closedBy: operatorId ?? null,
      },
    });
  }

  async reopen(companyId: string, periodKey: string) {
    const period = await this.findByKey(companyId, periodKey);
    if (period.status === AccountingPeriodStatus.OPEN) {
      return period;
    }

    return this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: AccountingPeriodStatus.OPEN,
        closedAt: null,
        closedBy: null,
      },
    });
  }

  async assertOpenForDate(companyId: string, value: Date | string) {
    const postingDate =
      value instanceof Date ? value : this.parseDate(value, '过账日期无效');
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: postingDate },
        endDate: { gte: postingDate },
      },
      orderBy: { startDate: 'desc' },
    });

    if (period?.status === AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException(
        `会计期间 ${period.periodKey} 已关账，不能在 ${postingDate.toISOString().slice(0, 10)} 过账`,
      );
    }
  }

  private async getCloseBlockers(
    companyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CloseBlockerCounts> {
    const dateRange = { gte: startDate, lte: endDate };
    const [
      invoices,
      customerPayments,
      creditNotes,
      customerRefunds,
      purchaseInvoices,
      supplierCreditNotes,
      supplierPayments,
      financeEvents,
    ] = await Promise.all([
      this.prisma.invoice.count({
        where: {
          companyId,
          issuedDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.payment.count({
        where: {
          companyId,
          paymentDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.creditNote.count({
        where: {
          companyId,
          creditDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.customerRefund.count({
        where: {
          companyId,
          refundDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.purchaseInvoice.count({
        where: {
          companyId,
          issuedDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.supplierCreditNote.count({
        where: {
          companyId,
          creditDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.supplierPayment.count({
        where: {
          companyId,
          paymentDate: dateRange,
          postingStatus: { not: EntryPostingStatus.POSTED },
        },
      }),
      this.prisma.eventDlq.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'FAILED'] },
          eventName: {
            in: [
              'finance.invoice.posted',
              'finance.payment.recorded',
              'finance.payment.applied',
              'finance.credit_note.posted',
              'finance.customer_refund.posted',
              'purchase.invoice.posted',
              'purchase.supplier_credit_note.posted',
              'purchase.supplier_payment.posted',
            ],
          },
        },
      }),
    ]);

    return {
      invoices,
      customerPayments,
      creditNotes,
      customerRefunds,
      purchaseInvoices,
      supplierCreditNotes,
      supplierPayments,
      financeEvents,
    };
  }

  private totalCloseBlockers(blockers: CloseBlockerCounts) {
    return Object.values(blockers).reduce((sum, count) => sum + count, 0);
  }

  private formatCloseBlockerMessage(blockers: CloseBlockerCounts) {
    const labels: Array<[keyof CloseBlockerCounts, string]> = [
      ['invoices', '未过账应收发票'],
      ['customerPayments', '未过账客户收款'],
      ['creditNotes', '未过账应收贷项'],
      ['customerRefunds', '未过账客户退款'],
      ['purchaseInvoices', '未过账应付发票'],
      ['supplierCreditNotes', '未过账供应商贷项'],
      ['supplierPayments', '未过账供应商付款'],
      ['financeEvents', '待处理财务异常事件'],
    ];
    const details = labels
      .filter(([key]) => blockers[key] > 0)
      .map(([key, label]) => `${label}: ${blockers[key]}`)
      .join('；');
    return `会计期间存在未完成财务事项，不能关账：${details}`;
  }

  private async findByKey(companyId: string, periodKey: string) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { companyId_periodKey: { companyId, periodKey } },
    });
    if (!period) {
      throw new BadRequestException('会计期间不存在');
    }
    return period;
  }

  private parseDate(value: string, message: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }
    return date;
  }
}
