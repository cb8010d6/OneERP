import type { EntryPostingStatus } from '@prisma/client';

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

export interface UnappliedPaymentRow {
  paymentId: string;
  partnerId: string;
  partnerName: string;
  paymentDate: string;
  method: string;
  amount: number;
  allocatedAmount: number;
  unappliedAmount: number;
  postingStatus: EntryPostingStatus;
}
