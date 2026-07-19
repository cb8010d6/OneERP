import { FinanceReportsService } from './finance-reports.service';

describe('FinanceReportsService', () => {
  const prisma = {
    journalEntryLine: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    account: {
      findMany: jest.fn(),
    },
  };

  const financeAccountMappingService = {
    resolveLineAccount: jest.fn(),
  };

  let service: FinanceReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceReportsService(
      prisma as never,
      financeAccountMappingService as never,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTrialBalance', () => {
    it('aggregates debit and credit by account', async () => {
      prisma.journalEntryLine.groupBy.mockResolvedValue([
        { accountId: 'acc-1', _sum: { debit: 1000, credit: 200 } },
        { accountId: 'acc-2', _sum: { debit: 50, credit: 800 } },
      ]);
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-1', code: '1002', name: '银行存款', type: 'ASSET' },
        { id: 'acc-2', code: '6001', name: '主营业务收入', type: 'REVENUE' },
      ]);

      const result = await service.getTrialBalance(
        'c1',
        '2026-06-01',
        '2026-06-30',
      );

      expect(result.totalDebit).toBe(1050);
      expect(result.totalCredit).toBe(1000);
      expect(result.difference).toBe(50);
      expect(result.balanced).toBe(false);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].code).toBe('1002');
      expect(result.rows[0].balance).toBe(800);
    });

    it('returns balanced when difference < 0.01', async () => {
      prisma.journalEntryLine.groupBy.mockResolvedValue([
        { accountId: 'acc-1', _sum: { debit: 500, credit: 500 } },
      ]);
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-1', code: '1001', name: '库存现金', type: 'ASSET' },
      ]);

      const result = await service.getTrialBalance('c1');
      expect(result.balanced).toBe(true);
      expect(result.difference).toBe(0);
    });
  });

  describe('getGeneralLedger', () => {
    it('builds a general ledger with opening and running balances', async () => {
      prisma.journalEntryLine.findMany.mockResolvedValue([
        {
          id: 'line-opening',
          journalEntryId: 'je-opening',
          lineNo: 1,
          accountId: 'bank-1',
          debit: 1000,
          credit: 100,
          memo: '期初余额',
          partner: null,
          account: { code: '1002', name: '银行存款', type: 'ASSET' },
          journalEntry: {
            entryNo: 'JE-OPEN',
            date: new Date('2026-05-31T00:00:00.000Z'),
            ref: 'OPEN-001',
            description: '期初导入',
          },
        },
        {
          id: 'line-inflow',
          journalEntryId: 'je-inflow',
          lineNo: 1,
          accountId: 'bank-1',
          debit: 500,
          credit: 0,
          memo: '客户回款',
          partner: { name: '蓝海科技' },
          account: { code: '1002', name: '银行存款', type: 'ASSET' },
          journalEntry: {
            entryNo: 'JE-001',
            date: new Date('2026-06-05T00:00:00.000Z'),
            ref: 'PAY-001',
            description: '客户收款',
          },
        },
        {
          id: 'line-outflow',
          journalEntryId: 'je-outflow',
          lineNo: 2,
          accountId: 'bank-1',
          debit: 0,
          credit: 300,
          memo: null,
          partner: null,
          account: { code: '1002', name: '银行存款', type: 'ASSET' },
          journalEntry: {
            entryNo: 'JE-002',
            date: new Date('2026-06-12T00:00:00.000Z'),
            ref: 'SUPPAY-001',
            description: '供应商付款',
          },
        },
      ]);

      const result = await service.getGeneralLedger(
        'c1',
        '2026-06-01',
        '2026-06-30',
        '1002',
      );

      expect(result.startDate).toBe('2026-06-01T00:00:00.000Z');
      expect(result.endDate).toBe('2026-06-30T23:59:59.999Z');
      expect(result.accountCode).toBe('1002');
      expect(result.totalOpeningBalance).toBe(900);
      expect(result.totalDebit).toBe(500);
      expect(result.totalCredit).toBe(300);
      expect(result.totalEndingBalance).toBe(1100);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].openingBalance).toBe(900);
      expect(result.accounts[0].endingBalance).toBe(1100);
      expect(result.accounts[0].lines).toHaveLength(2);
      expect(result.accounts[0].lines[0].partnerName).toBe('蓝海科技');
    });
  });

  describe('getIncomeStatement', () => {
    it('builds an income statement from posted revenue and expense accounts', async () => {
      prisma.journalEntryLine.findMany.mockResolvedValue([
        {
          accountId: 'rev-1',
          debit: 100,
          credit: 1200,
          account: { code: '6001', name: '主营业务收入', type: 'REVENUE' },
        },
        {
          accountId: 'exp-1',
          debit: 450,
          credit: 20,
          account: { code: '6401', name: '主营业务成本', type: 'EXPENSE' },
        },
        {
          accountId: 'exp-1',
          debit: 80,
          credit: 0,
          account: { code: '6401', name: '主营业务成本', type: 'EXPENSE' },
        },
      ]);

      const result = await service.getIncomeStatement(
        'c1',
        '2026-06-01',
        '2026-06-30',
      );

      expect(result.totalRevenue).toBe(1100);
      expect(result.totalExpense).toBe(510);
      expect(result.netIncome).toBe(590);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].type).toBe('REVENUE');
      expect(result.rows[0].amount).toBe(1100);
      expect(result.rows[1].type).toBe('EXPENSE');
      expect(result.rows[1].amount).toBe(510);
    });
  });

  describe('getBalanceSheet', () => {
    it('builds a balance sheet including unclosed current earnings', async () => {
      prisma.journalEntryLine.findMany.mockResolvedValue([
        {
          accountId: 'asset-1',
          debit: 1300,
          credit: 100,
          account: { code: '1002', name: '银行存款', type: 'ASSET' },
        },
        {
          accountId: 'liability-1',
          debit: 0,
          credit: 400,
          account: { code: '2202', name: '应付账款', type: 'LIABILITY' },
        },
        {
          accountId: 'equity-1',
          debit: 0,
          credit: 500,
          account: { code: '4001', name: '实收资本', type: 'EQUITY' },
        },
        {
          accountId: 'revenue-1',
          debit: 0,
          credit: 600,
          account: { code: '6001', name: '主营业务收入', type: 'REVENUE' },
        },
        {
          accountId: 'expense-1',
          debit: 300,
          credit: 0,
          account: { code: '6401', name: '主营业务成本', type: 'EXPENSE' },
        },
      ]);

      const result = await service.getBalanceSheet('c1', '2026-06-30');

      expect(result.totalAssets).toBe(1200);
      expect(result.totalLiabilities).toBe(400);
      expect(result.totalEquity).toBe(500);
      expect(result.currentEarnings).toBe(300);
      expect(result.totalLiabilitiesAndEquity).toBe(1200);
      expect(result.difference).toBe(0);
      expect(result.balanced).toBe(true);
      expect(result.rows).toHaveLength(3);
    });
  });

  describe('getCashFlowStatement', () => {
    it('builds a cash flow statement from mapped cash accounts', async () => {
      financeAccountMappingService.resolveLineAccount
        .mockResolvedValueOnce({
          accountCode: '1002',
          accountName: '银行存款',
          accountType: 'ASSET',
        })
        .mockResolvedValueOnce({
          accountCode: '1001',
          accountName: '库存现金',
          accountType: 'ASSET',
        })
        .mockResolvedValueOnce({
          accountCode: '101201',
          accountName: '支付宝',
          accountType: 'ASSET',
        })
        .mockResolvedValueOnce({
          accountCode: '101202',
          accountName: '微信支付',
          accountType: 'ASSET',
        });

      prisma.journalEntryLine.findMany.mockResolvedValue([
        {
          journalEntryId: 'je-opening',
          accountId: 'bank',
          debit: 1000,
          credit: 100,
          lineNo: 1,
          account: { code: '1002', name: '银行存款' },
          journalEntry: {
            entryNo: 'JE-OPEN',
            date: new Date('2026-05-31T00:00:00.000Z'),
            ref: 'OPEN',
            description: '期初余额',
          },
        },
        {
          journalEntryId: 'je-pay',
          accountId: 'bank',
          debit: 500,
          credit: 0,
          lineNo: 1,
          account: { code: '1002', name: '银行存款' },
          journalEntry: {
            entryNo: 'JE-PAY',
            date: new Date('2026-06-05T00:00:00.000Z'),
            ref: 'PAY-001',
            description: '客户收款自动凭证',
          },
        },
        {
          journalEntryId: 'je-supplier',
          accountId: 'bank',
          debit: 0,
          credit: 200,
          lineNo: 1,
          account: { code: '1002', name: '银行存款' },
          journalEntry: {
            entryNo: 'JE-SUP',
            date: new Date('2026-06-08T00:00:00.000Z'),
            ref: 'SUPPAY-001',
            description: '供应商付款自动凭证',
          },
        },
        {
          journalEntryId: 'je-invest',
          accountId: 'bank',
          debit: 0,
          credit: 300,
          lineNo: 1,
          account: { code: '1002', name: '银行存款' },
          journalEntry: {
            entryNo: 'JE-INVEST',
            date: new Date('2026-06-10T00:00:00.000Z'),
            ref: 'INVEST-001',
            description: '固定资产投资',
          },
        },
      ]);

      const result = await service.getCashFlowStatement(
        'c1',
        '2026-06-01',
        '2026-06-30',
      );

      expect(result.startDate).toBe('2026-06-01T00:00:00.000Z');
      expect(result.beginningCash).toBe(900);
      expect(result.totalCashInflow).toBe(500);
      expect(result.totalCashOutflow).toBe(500);
      expect(result.operatingCashFlow).toBe(300);
      expect(result.investingCashFlow).toBe(-300);
      expect(result.netCashFlow).toBe(0);
      expect(result.endingCash).toBe(900);
      expect(result.cashAccountCodes).toEqual([
        '1001',
        '1002',
        '101201',
        '101202',
      ]);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].category).toBe('OPERATING');
      expect(result.rows[0].cashInflow).toBe(500);
      expect(result.rows[2].category).toBe('INVESTING');
      expect(result.rows[2].cashOutflow).toBe(300);
    });
  });
});
