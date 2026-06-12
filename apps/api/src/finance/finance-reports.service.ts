import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceAccountMappingService } from './finance-account-mapping.service';
import { EntryPostingStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { roundDecimal } from '../core/utils/decimal';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface TrialBalanceResult {
  startDate: string | null;
  endDate: string | null;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
  rows: TrialBalanceRow[];
}

export interface GeneralLedgerLine {
  lineId: string;
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  lineNo: number;
  partnerName: string | null;
  memo: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: GeneralLedgerLine[];
}

export interface GeneralLedgerResult {
  startDate: string | null;
  endDate: string;
  accountCode: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  accounts: GeneralLedgerAccount[];
}

export interface IncomeStatementRow {
  accountId: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  debit: number;
  credit: number;
  amount: number;
}

export interface IncomeStatementResult {
  startDate: string | null;
  endDate: string | null;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  rows: IncomeStatementRow[];
}

export interface BalanceSheetRow {
  accountId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY';
  debit: number;
  credit: number;
  amount: number;
}

export interface BalanceSheetResult {
  asOfDate: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentEarnings: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  balanced: boolean;
  rows: BalanceSheetRow[];
}

export type CashFlowCategory = 'OPERATING' | 'INVESTING' | 'FINANCING';

export interface CashFlowRow {
  journalEntryId: string;
  entryNo: string;
  date: string;
  ref: string | null;
  description: string | null;
  accountCode: string;
  accountName: string;
  category: CashFlowCategory;
  cashInflow: number;
  cashOutflow: number;
  netCashFlow: number;
}

export interface CashFlowResult {
  startDate: string | null;
  endDate: string;
  beginningCash: number;
  totalCashInflow: number;
  totalCashOutflow: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashFlow: number;
  endingCash: number;
  cashAccountCodes: string[];
  rows: CashFlowRow[];
}

@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeAccountMappingService: FinanceAccountMappingService,
  ) {}

  private round2(value: number) {
    return roundDecimal(value);
  }

  private parseTrialBalanceDate(
    value: string | undefined,
    fieldName: 'startDate' | 'endDate',
  ) {
    if (!value) return undefined;
    const normalized =
      fieldName === 'endDate' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T23:59:59.999Z`
        : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} 日期格式无效`);
    }
    return date;
  }

  private parseAsOfDate(value?: string) {
    if (!value) return new Date();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('asOfDate 日期格式无效');
    }
    return date;
  }

  private accountBalanceEffect(type: string, debit: number, credit: number) {
    return ['ASSET', 'EXPENSE'].includes(type)
      ? debit - credit
      : credit - debit;
  }

  private incomeStatementAmount(type: string, debit: number, credit: number) {
    return type === 'REVENUE' ? credit - debit : debit - credit;
  }

  private balanceSheetAmount(type: string, debit: number, credit: number) {
    return this.accountBalanceEffect(type, debit, credit);
  }

  private cashFlowCategory(
    ref: string | null,
    description: string | null,
  ): CashFlowCategory {
    const text = `${ref ?? ''} ${description ?? ''}`.toLowerCase();
    if (
      text.includes('采购') ||
      text.includes('purchase') ||
      text.includes('工资') ||
      text.includes('salary') ||
      text.includes('费用') ||
      text.includes('expense')
    ) {
      return 'OPERATING';
    }
    if (
      text.includes('投资') ||
      text.includes('invest') ||
      text.includes('固定资产')
    ) {
      return 'INVESTING';
    }
    if (
      text.includes('融资') ||
      text.includes('financ') ||
      text.includes('借款') ||
      text.includes('贷款')
    ) {
      return 'FINANCING';
    }
    return 'OPERATING';
  }

  async getTrialBalance(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<TrialBalanceResult> {
    const parsedStartDate = this.parseTrialBalanceDate(startDate, 'startDate');
    const parsedEndDate = this.parseTrialBalanceDate(endDate, 'endDate');

    if (
      parsedStartDate &&
      parsedEndDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const journalEntryWhere: Prisma.JournalEntryWhereInput = {
      companyId,
      postingStatus: EntryPostingStatus.POSTED,
    };
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parsedStartDate) dateFilter.gte = parsedStartDate;
    if (parsedEndDate) dateFilter.lte = parsedEndDate;
    if (Object.keys(dateFilter).length > 0) {
      journalEntryWhere.date = dateFilter;
    }

    const aggregated = await this.prisma.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: journalEntryWhere },
      _sum: { debit: true, credit: true },
    });

    const accountIds = aggregated.map((r) => r.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true, type: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    let totalDebit = 0;
    let totalCredit = 0;

    const rows: TrialBalanceRow[] = aggregated
      .map((r) => {
        const debit = this.round2(Number(r._sum.debit ?? 0));
        const credit = this.round2(Number(r._sum.credit ?? 0));
        totalDebit = this.round2(totalDebit + debit);
        totalCredit = this.round2(totalCredit + credit);
        const account = accountMap.get(r.accountId)!;
        return {
          accountId: r.accountId,
          code: account.code,
          name: account.name,
          type: account.type,
          debit,
          credit,
          balance: this.round2(debit - credit),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const difference = this.round2(totalDebit - totalCredit);

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate?.toISOString() ?? null,
      totalDebit,
      totalCredit,
      difference,
      balanced: Math.abs(difference) < 0.01,
      rows,
    };
  }

  async getGeneralLedger(
    companyId: string,
    startDate?: string,
    endDate?: string,
    accountCode?: string,
  ): Promise<GeneralLedgerResult> {
    const parsedStartDate = this.parseTrialBalanceDate(startDate, 'startDate');
    const parsedEndDate =
      this.parseTrialBalanceDate(endDate, 'endDate') ?? new Date();

    if (
      parsedStartDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const normalizedAccountCode = accountCode?.trim() || undefined;
    const lineWhere: Prisma.JournalEntryLineWhereInput = {
      journalEntry: {
        companyId,
        postingStatus: EntryPostingStatus.POSTED,
        date: { lte: parsedEndDate },
      },
    };
    if (normalizedAccountCode) {
      lineWhere.account = { code: normalizedAccountCode };
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: lineWhere,
      include: {
        account: true,
        journalEntry: true,
        partner: true,
      },
      orderBy: [
        { account: { code: 'asc' } },
        { journalEntry: { date: 'asc' } },
        { journalEntry: { entryNo: 'asc' } },
        { lineNo: 'asc' },
      ],
    });

    const accountsById = new Map<string, GeneralLedgerAccount>();
    for (const line of lines) {
      const account = accountsById.get(line.accountId) ?? {
        accountId: line.accountId,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        openingBalance: 0,
        periodDebit: 0,
        periodCredit: 0,
        endingBalance: 0,
        lines: [],
      };
      accountsById.set(line.accountId, account);

      const debit = this.round2(Number(line.debit ?? 0));
      const credit = this.round2(Number(line.credit ?? 0));
      const balanceEffect = this.accountBalanceEffect(
        line.account.type,
        debit,
        credit,
      );
      const lineDate = line.journalEntry.date;

      if (parsedStartDate && lineDate.getTime() < parsedStartDate.getTime()) {
        account.openingBalance = this.round2(
          account.openingBalance + balanceEffect,
        );
        account.endingBalance = account.openingBalance;
        continue;
      }

      account.periodDebit = this.round2(account.periodDebit + debit);
      account.periodCredit = this.round2(account.periodCredit + credit);
      account.endingBalance = this.round2(
        account.endingBalance + balanceEffect,
      );
      account.lines.push({
        lineId: line.id,
        journalEntryId: line.journalEntryId,
        entryNo: line.journalEntry.entryNo,
        date: lineDate.toISOString(),
        ref: line.journalEntry.ref,
        description: line.journalEntry.description,
        lineNo: line.lineNo,
        partnerName: line.partner?.name ?? null,
        memo: line.memo,
        debit,
        credit,
        runningBalance: account.endingBalance,
      });
    }

    const accounts = [...accountsById.values()]
      .map((account) => ({
        ...account,
        endingBalance: this.round2(
          account.openingBalance +
            this.accountBalanceEffect(
              account.type,
              account.periodDebit,
              account.periodCredit,
            ),
        ),
      }))
      .filter(
        (account) =>
          Math.abs(account.openingBalance) >= 0.01 ||
          Math.abs(account.periodDebit) >= 0.01 ||
          Math.abs(account.periodCredit) >= 0.01 ||
          Math.abs(account.endingBalance) >= 0.01,
      )
      .sort((a, b) => a.code.localeCompare(b.code));

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate.toISOString(),
      accountCode: normalizedAccountCode ?? null,
      totalOpeningBalance: this.round2(
        accounts.reduce((sum, account) => sum + account.openingBalance, 0),
      ),
      totalDebit: this.round2(
        accounts.reduce((sum, account) => sum + account.periodDebit, 0),
      ),
      totalCredit: this.round2(
        accounts.reduce((sum, account) => sum + account.periodCredit, 0),
      ),
      totalEndingBalance: this.round2(
        accounts.reduce((sum, account) => sum + account.endingBalance, 0),
      ),
      accounts,
    };
  }

  async getIncomeStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<IncomeStatementResult> {
    const parsedStartDate = this.parseTrialBalanceDate(startDate, 'startDate');
    const parsedEndDate = this.parseTrialBalanceDate(endDate, 'endDate');

    if (
      parsedStartDate &&
      parsedEndDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const journalEntryWhere: Prisma.JournalEntryWhereInput = {
      companyId,
      postingStatus: EntryPostingStatus.POSTED,
    };
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parsedStartDate) dateFilter.gte = parsedStartDate;
    if (parsedEndDate) dateFilter.lte = parsedEndDate;
    if (Object.keys(dateFilter).length > 0) {
      journalEntryWhere.date = dateFilter;
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: journalEntryWhere,
        account: { type: { in: ['REVENUE', 'EXPENSE'] } },
      },
      include: { account: true },
    });

    const rowsByAccount = new Map<string, IncomeStatementRow>();
    for (const line of lines) {
      const debit = this.round2(Number(line.debit ?? 0));
      const credit = this.round2(Number(line.credit ?? 0));
      const type = line.account.type === 'REVENUE' ? 'REVENUE' : 'EXPENSE';
      const existing = rowsByAccount.get(line.accountId);

      if (existing) {
        existing.debit = this.round2(existing.debit + debit);
        existing.credit = this.round2(existing.credit + credit);
        existing.amount = this.incomeStatementAmount(
          existing.type,
          existing.debit,
          existing.credit,
        );
        continue;
      }

      rowsByAccount.set(line.accountId, {
        accountId: line.accountId,
        code: line.account.code,
        name: line.account.name,
        type,
        debit,
        credit,
        amount: this.incomeStatementAmount(type, debit, credit),
      });
    }

    const rows = [...rowsByAccount.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    const totalRevenue = this.round2(
      rows
        .filter((row) => row.type === 'REVENUE')
        .reduce((sum, row) => sum + row.amount, 0),
    );
    const totalExpense = this.round2(
      rows
        .filter((row) => row.type === 'EXPENSE')
        .reduce((sum, row) => sum + row.amount, 0),
    );

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate?.toISOString() ?? null,
      totalRevenue,
      totalExpense,
      netIncome: this.round2(totalRevenue - totalExpense),
      rows,
    };
  }

  async getBalanceSheet(
    companyId: string,
    asOfDate?: string,
  ): Promise<BalanceSheetResult> {
    const parsedAsOfDate = this.parseAsOfDate(asOfDate);
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          date: { lte: parsedAsOfDate },
        },
        account: {
          type: { in: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] },
        },
      },
      include: { account: true },
    });

    const rowsByAccount = new Map<string, BalanceSheetRow>();
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const line of lines) {
      const debit = this.round2(Number(line.debit ?? 0));
      const credit = this.round2(Number(line.credit ?? 0));
      const accountType = line.account.type;

      if (accountType === 'REVENUE') {
        totalRevenue = this.round2(
          totalRevenue + this.incomeStatementAmount('REVENUE', debit, credit),
        );
        continue;
      }
      if (accountType === 'EXPENSE') {
        totalExpense = this.round2(
          totalExpense + this.incomeStatementAmount('EXPENSE', debit, credit),
        );
        continue;
      }
      if (
        accountType !== 'ASSET' &&
        accountType !== 'LIABILITY' &&
        accountType !== 'EQUITY'
      ) {
        continue;
      }

      const existing = rowsByAccount.get(line.accountId);
      if (existing) {
        existing.debit = this.round2(existing.debit + debit);
        existing.credit = this.round2(existing.credit + credit);
        existing.amount = this.balanceSheetAmount(
          existing.type,
          existing.debit,
          existing.credit,
        );
        continue;
      }

      rowsByAccount.set(line.accountId, {
        accountId: line.accountId,
        code: line.account.code,
        name: line.account.name,
        type: accountType,
        debit,
        credit,
        amount: this.balanceSheetAmount(accountType, debit, credit),
      });
    }

    const rows = [...rowsByAccount.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    const totalAssets = this.round2(
      rows
        .filter((row) => row.type === 'ASSET')
        .reduce((sum, row) => sum + row.amount, 0),
    );
    const totalLiabilities = this.round2(
      rows
        .filter((row) => row.type === 'LIABILITY')
        .reduce((sum, row) => sum + row.amount, 0),
    );
    const totalEquity = this.round2(
      rows
        .filter((row) => row.type === 'EQUITY')
        .reduce((sum, row) => sum + row.amount, 0),
    );
    const currentEarnings = this.round2(totalRevenue - totalExpense);
    const totalLiabilitiesAndEquity = this.round2(
      totalLiabilities + totalEquity + currentEarnings,
    );
    const difference = this.round2(totalAssets - totalLiabilitiesAndEquity);

    return {
      asOfDate: parsedAsOfDate.toISOString(),
      totalAssets,
      totalLiabilities,
      totalEquity,
      currentEarnings,
      totalLiabilitiesAndEquity,
      difference,
      balanced: Math.abs(difference) < 0.01,
      rows,
    };
  }

  async getCashFlowStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<CashFlowResult> {
    const parsedStartDate = this.parseTrialBalanceDate(startDate, 'startDate');
    const parsedEndDate =
      this.parseTrialBalanceDate(endDate, 'endDate') ?? new Date();

    if (
      parsedStartDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const cashAccountCodes = [
      ...new Set(
        (
          await Promise.all([
            this.financeAccountMappingService.resolveLineAccount(
              companyId,
              'BANK',
            ),
            this.financeAccountMappingService.resolveLineAccount(
              companyId,
              'CASH',
            ),
            this.financeAccountMappingService.resolveLineAccount(
              companyId,
              'ALIPAY',
            ),
            this.financeAccountMappingService.resolveLineAccount(
              companyId,
              'WECHAT',
            ),
          ])
        ).map((account) => account.accountCode),
      ),
    ].sort((a, b) => a.localeCompare(b));

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          date: { lte: parsedEndDate },
        },
        account: { code: { in: cashAccountCodes } },
      },
      include: {
        account: true,
        journalEntry: true,
      },
      orderBy: [{ journalEntry: { date: 'asc' } }, { lineNo: 'asc' }],
    });

    let beginningCash = 0;
    let totalCashInflow = 0;
    let totalCashOutflow = 0;
    const rows: CashFlowRow[] = [];

    for (const line of lines) {
      const cashInflow = this.round2(Number(line.debit ?? 0));
      const cashOutflow = this.round2(Number(line.credit ?? 0));
      const netCashFlow = this.round2(cashInflow - cashOutflow);
      const lineDate = line.journalEntry.date;

      if (parsedStartDate && lineDate.getTime() < parsedStartDate.getTime()) {
        beginningCash = this.round2(beginningCash + netCashFlow);
        continue;
      }

      totalCashInflow = this.round2(totalCashInflow + cashInflow);
      totalCashOutflow = this.round2(totalCashOutflow + cashOutflow);
      rows.push({
        journalEntryId: line.journalEntryId,
        entryNo: line.journalEntry.entryNo,
        date: lineDate.toISOString(),
        ref: line.journalEntry.ref,
        description: line.journalEntry.description,
        accountCode: line.account.code,
        accountName: line.account.name,
        category: this.cashFlowCategory(
          line.journalEntry.ref,
          line.journalEntry.description,
        ),
        cashInflow,
        cashOutflow,
        netCashFlow,
      });
    }

    const operatingCashFlow = this.round2(
      rows
        .filter((row) => row.category === 'OPERATING')
        .reduce((sum, row) => sum + row.netCashFlow, 0),
    );
    const investingCashFlow = this.round2(
      rows
        .filter((row) => row.category === 'INVESTING')
        .reduce((sum, row) => sum + row.netCashFlow, 0),
    );
    const financingCashFlow = this.round2(
      rows
        .filter((row) => row.category === 'FINANCING')
        .reduce((sum, row) => sum + row.netCashFlow, 0),
    );
    const netCashFlow = this.round2(totalCashInflow - totalCashOutflow);

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate.toISOString(),
      beginningCash,
      totalCashInflow,
      totalCashOutflow,
      operatingCashFlow,
      investingCashFlow,
      financingCashFlow,
      netCashFlow,
      endingCash: this.round2(beginningCash + netCashFlow),
      cashAccountCodes,
      rows,
    };
  }
}
