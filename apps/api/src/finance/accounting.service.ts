import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EntryPostingStatus, JournalType, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { roundDecimal } from '../core/utils/decimal';

interface JournalLineInput {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit?: Decimal.Value;
  credit?: Decimal.Value;
  partnerId?: string;
  memo?: string;
}

interface CreateBalancedEntryInput {
  companyId: string;
  journalCode: string;
  journalName: string;
  journalType: JournalType;
  date?: Date;
  ref?: string;
  description?: string;
  createdBy?: string;
  lines: JournalLineInput[];
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async postStockDepletedEntry(payload: {
    companyId: string;
    referenceNo?: string;
    materialId: string;
    quantity: number;
    unitCost?: number;
    operatorId?: string;
  }) {
    const material = await this.prisma.material.findFirst({
      where: { id: payload.materialId },
      select: { name: true, unitPrice: true },
    });

    const unitCost = new Decimal(payload.unitCost ?? material?.unitPrice ?? 0);
    const amount = this.money(unitCost.times(payload.quantity ?? 0));
    if (amount.lte(0)) {
      this.logger.warn(
        `跳过零成本库存出库凭证: material=${payload.materialId}`,
      );
      return null;
    }

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'INV',
      journalName: 'Inventory Journal',
      journalType: JournalType.INVENTORY,
      ref: payload.referenceNo,
      description: `库存出库自动凭证: ${material?.name ?? payload.materialId}`,
      createdBy: payload.operatorId,
      lines: [
        {
          accountCode: '6401',
          accountName: '主营业务成本',
          accountType: 'EXPENSE',
          debit: amount,
          memo: '库存出库结转成本',
        },
        {
          accountCode: '1405',
          accountName: '库存商品',
          accountType: 'ASSET',
          credit: amount,
          memo: '库存出库结转成本',
        },
      ],
    });
  }

  async postInvoicePostedEntry(payload: {
    companyId: string;
    invoiceId: string;
    taxCodeId?: string | null;
    taxRate?: number;
    operatorId?: string;
  }) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: payload.invoiceId, companyId: payload.companyId },
      include: {
        order: { select: { orderNo: true, partnerId: true } },
        taxCode: { include: { account: true } },
      },
    });

    if (!invoice) {
      throw new BadRequestException('发票不存在，无法生成凭证');
    }

    const amount = this.money(invoice.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('发票金额必须大于0');
    }

    let revenue = this.money(invoice.subTotal ?? 0);
    let tax = this.money(invoice.taxAmount ?? 0);

    if (revenue.lte(0) && tax.lte(0)) {
      const fallbackRate = Decimal.min(
        Decimal.max(
          new Decimal(payload.taxRate ?? invoice.taxCode?.rate ?? 0.13),
          0,
        ),
        1,
      );
      revenue = this.money(amount.div(new Decimal(1).plus(fallbackRate)));
      tax = this.money(amount.minus(revenue));
      this.logger.warn(
        `发票未包含税额快照，使用兜底税率计算: invoice=${invoice.invoiceNo}`,
      );
    }

    const resolvedTaxCode = invoice.taxCode
      ? invoice.taxCode
      : payload.taxCodeId
        ? await this.prisma.taxCode.findFirst({
            where: {
              id: payload.taxCodeId,
              companyId: payload.companyId,
              active: true,
            },
            include: { account: true },
          })
        : null;

    const taxAccount = resolvedTaxCode?.account;
    if (!taxAccount) {
      this.logger.warn(
        `未配置税码会计科目，使用默认销项税科目: invoice=${invoice.invoiceNo}`,
      );
    }

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'SAL',
      journalName: 'Sales Journal',
      journalType: JournalType.SALES,
      ref: invoice.invoiceNo,
      description: `销售开票自动凭证: ${invoice.invoiceNo}`,
      createdBy: payload.operatorId,
      lines: [
        {
          accountCode: '1122',
          accountName: '应收账款',
          accountType: 'ASSET',
          debit: amount,
          partnerId: invoice.order.partnerId,
          memo: `应收 ${invoice.invoiceNo}`,
        },
        {
          accountCode: '6001',
          accountName: '主营业务收入',
          accountType: 'REVENUE',
          credit: revenue,
          partnerId: invoice.order.partnerId,
          memo: `收入 ${invoice.invoiceNo}`,
        },
        {
          accountCode: taxAccount?.code ?? '222101',
          accountName: taxAccount?.name ?? '应交税费-销项税',
          accountType: taxAccount?.type ?? 'LIABILITY',
          credit: tax,
          memo: `销项税 ${invoice.invoiceNo}`,
        },
      ],
    });
  }

  async createBalancedEntry(input: CreateBalancedEntryInput) {
    await this.ensureDefaultMasterData(input.companyId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `journal-entry-${input.companyId}`,
      );

      const lines = input.lines.map((line) => ({
        ...line,
        debit: this.money(line.debit ?? 0),
        credit: this.money(line.credit ?? 0),
      }));

      this.validateLines(lines);
      const totalDebit = this.money(
        lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0)),
      );
      const totalCredit = this.money(
        lines.reduce((sum, line) => sum.plus(line.credit), new Decimal(0)),
      );

      if (!totalDebit.eq(totalCredit)) {
        throw new BadRequestException(
          `借贷不平衡: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}`,
        );
      }

      const journal = await tx.journal.upsert({
        where: {
          companyId_code: {
            companyId: input.companyId,
            code: input.journalCode,
          },
        },
        update: {
          name: input.journalName,
          type: input.journalType,
          isActive: true,
        },
        create: {
          companyId: input.companyId,
          code: input.journalCode,
          name: input.journalName,
          type: input.journalType,
        },
      });

      const entry = await tx.journalEntry.create({
        data: {
          entryNo: this.generateEntryNo(),
          date: input.date ?? new Date(),
          ref: input.ref,
          description: input.description,
          journalId: journal.id,
          companyId: input.companyId,
          createdBy: input.createdBy,
          postingStatus: EntryPostingStatus.POSTED,
          postedAt: new Date(),
          lines: {
            create: await Promise.all(
              lines.map(async (line, index) => {
                const account = await this.getPostingAccount(
                  tx,
                  input.companyId,
                  line.accountCode,
                );

                return {
                  lineNo: index + 1,
                  accountId: account.id,
                  partnerId: line.partnerId,
                  debit: line.debit,
                  credit: line.credit,
                  memo: line.memo,
                };
              }),
            ),
          },
        },
        include: {
          lines: {
            include: { account: true },
            orderBy: { lineNo: 'asc' },
          },
          journal: true,
        },
      });

      return {
        ...entry,
        totals: {
          debit: totalDebit.toNumber(),
          credit: totalCredit.toNumber(),
        },
      };
    });
  }

  private async ensureDefaultMasterData(companyId: string) {
    await this.prisma.journal.upsert({
      where: { companyId_code: { companyId, code: 'GEN' } },
      update: {
        name: 'General Journal',
        type: JournalType.GENERAL,
        isActive: true,
      },
      create: {
        companyId,
        code: 'GEN',
        name: 'General Journal',
        type: JournalType.GENERAL,
      },
    });

    const defaultAccounts = [
      { code: '1122', name: '应收账款', type: 'ASSET' },
      { code: '1405', name: '库存商品', type: 'ASSET' },
      { code: '222101', name: '应交税费-销项税', type: 'LIABILITY' },
      { code: '6001', name: '主营业务收入', type: 'REVENUE' },
      { code: '6401', name: '主营业务成本', type: 'EXPENSE' },
    ];

    for (const account of defaultAccounts) {
      await this.prisma.account.upsert({
        where: { companyId_code: { companyId, code: account.code } },
        update: {
          name: account.name,
          type: account.type,
          isActive: true,
        },
        create: {
          companyId,
          code: account.code,
          name: account.name,
          type: account.type,
          isActive: true,
        },
      });
    }
  }

  private async getPostingAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    code: string,
  ) {
    const account = await tx.account.findFirst({
      where: {
        companyId,
        code,
        isActive: true,
      },
    });

    if (!account) {
      throw new BadRequestException(`会计科目不存在或已停用: ${code}`);
    }

    return account;
  }

  private validateLines(lines: Array<{ debit: Decimal; credit: Decimal }>) {
    if (!lines.length) {
      throw new BadRequestException('凭证分录不能为空');
    }

    for (const line of lines) {
      if (line.debit.lt(0) || line.credit.lt(0)) {
        throw new BadRequestException('分录金额不能为负数');
      }
      if (
        (line.debit.eq(0) && line.credit.eq(0)) ||
        (line.debit.gt(0) && line.credit.gt(0))
      ) {
        throw new BadRequestException('每行分录必须仅填写借方或贷方');
      }
    }
  }

  private generateEntryNo() {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const suffix = String(now.getTime()).slice(-6);
    return `JE-${datePart}-${suffix}`;
  }

  private money(value: Decimal.Value) {
    return new Decimal(roundDecimal(value));
  }
}
