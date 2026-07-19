import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankStatementLineStatus,
  EntryPostingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { roundDecimal } from '../core/utils/decimal';
import {
  ImportBankStatementLinesDto,
  MatchBankStatementLineDto,
} from './dto/finance.dto';

@Injectable()
export class BankStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async importBankStatementLines(
    companyId: string,
    dto: ImportBankStatementLinesDto,
  ) {
    const lines = (dto.lines ?? []).slice(0, 200);
    if (lines.length === 0) {
      throw new BadRequestException('请提供银行流水');
    }

    const results: Array<{
      externalRef?: string | null;
      status: 'IMPORTED' | 'SKIPPED';
      id?: string;
      message?: string;
    }> = [];

    for (const line of lines) {
      const transactionDate = new Date(line.transactionDate);
      if (Number.isNaN(transactionDate.getTime())) {
        throw new BadRequestException('银行流水交易日期无效');
      }
      const amount = roundDecimal(Number(line.amount));
      if (amount === 0) {
        throw new BadRequestException('银行流水金额不能为0');
      }
      const externalRef = line.externalRef?.trim() || null;
      if (externalRef) {
        const existing = await this.prisma.bankStatementLine.findUnique({
          where: { companyId_externalRef: { companyId, externalRef } },
          select: { id: true },
        });
        if (existing) {
          results.push({
            externalRef,
            status: 'SKIPPED',
            id: existing.id,
            message: '银行流水已存在',
          });
          continue;
        }
      }

      const created = await this.prisma.bankStatementLine.create({
        data: {
          companyId,
          bankAccount: line.bankAccount?.trim() || null,
          transactionDate,
          description: line.description?.trim() || null,
          counterparty: line.counterparty?.trim() || null,
          amount,
          externalRef,
          status: BankStatementLineStatus.UNMATCHED,
        },
      });
      results.push({
        externalRef,
        status: 'IMPORTED',
        id: created.id,
      });
    }

    return {
      total: lines.length,
      imported: results.filter((result) => result.status === 'IMPORTED').length,
      skipped: results.filter((result) => result.status === 'SKIPPED').length,
      results,
    };
  }

  async getBankStatementLines(companyId: string, status?: string) {
    const resolvedStatus =
      status === BankStatementLineStatus.MATCHED ||
      status === BankStatementLineStatus.UNMATCHED
        ? status
        : undefined;
    const rows = await this.prisma.bankStatementLine.findMany({
      where: {
        companyId,
        status: resolvedStatus,
      },
      include: {
        payment: { include: { partner: { select: { id: true, name: true } } } },
        supplierPayment: {
          include: { supplier: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const rowsWithCandidates = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        matchCandidates:
          row.status === BankStatementLineStatus.UNMATCHED
            ? await this.findMatchCandidates(companyId, row)
            : [],
      })),
    );

    return { rows: rowsWithCandidates };
  }

  async autoMatchBankStatementLines(companyId: string, operatorId?: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { companyId, status: BankStatementLineStatus.UNMATCHED },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    const results: Array<{
      bankStatementLineId: string;
      status: 'MATCHED' | 'SKIPPED';
      targetType?: 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT';
      targetId?: string;
      message?: string;
    }> = [];

    for (const line of lines) {
      const candidates = await this.findMatchCandidates(companyId, line);
      if (candidates.length !== 1) {
        results.push({
          bankStatementLineId: line.id,
          status: 'SKIPPED',
          message: candidates.length === 0 ? '无匹配候选' : '存在多个候选',
        });
        continue;
      }

      const [candidate] = candidates;
      await this.matchBankStatementLine(
        companyId,
        line.id,
        {
          targetType: candidate.targetType,
          targetId: candidate.targetId,
        },
        operatorId,
      );
      results.push({
        bankStatementLineId: line.id,
        status: 'MATCHED',
        targetType: candidate.targetType,
        targetId: candidate.targetId,
      });
    }

    return {
      total: lines.length,
      matched: results.filter((result) => result.status === 'MATCHED').length,
      skipped: results.filter((result) => result.status === 'SKIPPED').length,
      results,
    };
  }

  async matchBankStatementLine(
    companyId: string,
    bankStatementLineId: string,
    dto: MatchBankStatementLineDto,
    operatorId?: string,
  ) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id: bankStatementLineId, companyId },
    });
    if (!line) {
      throw new NotFoundException('银行流水不存在');
    }
    if (line.status === BankStatementLineStatus.MATCHED) {
      throw new BadRequestException('银行流水已匹配');
    }

    const amount = roundDecimal(Number(line.amount));
    if (dto.targetType === 'CUSTOMER_PAYMENT') {
      const payment = await this.prisma.payment.findFirst({
        where: { id: dto.targetId, companyId },
        select: { id: true, amount: true, postingStatus: true },
      });
      if (!payment) {
        throw new NotFoundException('客户收款不存在');
      }
      if (payment.postingStatus !== EntryPostingStatus.POSTED) {
        throw new BadRequestException('客户收款尚未过账，不能匹配银行流水');
      }
      if (amount <= 0 || roundDecimal(Number(payment.amount)) !== amount) {
        throw new BadRequestException('银行流水金额与客户收款金额不一致');
      }
      return this.prisma.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: BankStatementLineStatus.MATCHED,
          paymentId: payment.id,
          supplierPaymentId: null,
          matchedAt: new Date(),
          matchedBy: operatorId ?? null,
        },
      });
    }

    const supplierPayment = await this.prisma.supplierPayment.findFirst({
      where: { id: dto.targetId, companyId },
      select: { id: true, amount: true, postingStatus: true },
    });
    if (!supplierPayment) {
      throw new NotFoundException('供应商付款不存在');
    }
    if (supplierPayment.postingStatus !== EntryPostingStatus.POSTED) {
      throw new BadRequestException('供应商付款尚未过账，不能匹配银行流水');
    }
    if (
      amount >= 0 ||
      roundDecimal(Number(supplierPayment.amount)) !==
        roundDecimal(Math.abs(amount))
    ) {
      throw new BadRequestException('银行流水金额与供应商付款金额不一致');
    }
    return this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: BankStatementLineStatus.MATCHED,
        paymentId: null,
        supplierPaymentId: supplierPayment.id,
        matchedAt: new Date(),
        matchedBy: operatorId ?? null,
      },
    });
  }

  private async findMatchCandidates(
    companyId: string,
    line: { amount: Prisma.Decimal | number | string; transactionDate: Date },
  ) {
    const amount = roundDecimal(Number(line.amount));
    if (amount > 0) {
      const payments = await this.prisma.payment.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          amount,
          bankStatementLines: {
            none: { status: BankStatementLineStatus.MATCHED },
          },
        },
        include: { partner: { select: { id: true, name: true } } },
        orderBy: { paymentDate: 'desc' },
        take: 5,
      });
      return payments.map((payment) => ({
        targetType: 'CUSTOMER_PAYMENT' as const,
        targetId: payment.id,
        label: payment.partner.name,
        amount: roundDecimal(Number(payment.amount)),
        date: payment.paymentDate.toISOString(),
      }));
    }

    const supplierPayments = await this.prisma.supplierPayment.findMany({
      where: {
        companyId,
        postingStatus: EntryPostingStatus.POSTED,
        amount: roundDecimal(Math.abs(amount)),
        bankStatementLines: {
          none: { status: BankStatementLineStatus.MATCHED },
        },
      },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { paymentDate: 'desc' },
      take: 5,
    });
    return supplierPayments.map((payment) => ({
      targetType: 'SUPPLIER_PAYMENT' as const,
      targetId: payment.id,
      label: payment.supplier.name,
      amount: roundDecimal(Number(payment.amount)),
      date: payment.paymentDate.toISOString(),
    }));
  }
}
