import { Test, TestingModule } from '@nestjs/testing';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceDlqService } from './finance-dlq.service';
import { AccountingService } from './accounting.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';

describe('FinanceController', () => {
  let controller: FinanceController;

  const mockFinanceService = {
    createInvoice: jest.fn(),
    getInvoices: jest.fn(),
    recordPayment: jest.fn(),
    postInvoice: jest.fn(),
    getJournalEntries: jest.fn(),
  };

  const mockFinanceDlqService = {
    list: jest.fn(),
    retryPending: jest.fn(),
  };

  const mockAccountingService = {
    reverseJournalEntry: jest.fn(),
    getTrialBalance: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: FinanceDlqService, useValue: mockFinanceDlqService },
        { provide: AccountingService, useValue: mockAccountingService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FinanceController>(FinanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createInvoice', () => {
    it('should create an invoice', async () => {
      const expected = { id: 'inv1', amount: 1000 };
      mockFinanceService.createInvoice.mockResolvedValue(expected);

      const result = await controller.createInvoice(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        { orderId: 'o1', amount: 1000, dueDate: '2025-12-31' },
      );

      expect(result).toEqual(expected);
      expect(mockFinanceService.createInvoice).toHaveBeenCalledWith(
        'c1',
        { orderId: 'o1', amount: 1000, dueDate: '2025-12-31' },
        'u1',
      );
    });
  });

  describe('getInvoices', () => {
    it('should return invoices', async () => {
      const expected = { data: [], total: 0 };
      mockFinanceService.getInvoices.mockResolvedValue(expected);

      const result = await controller.getInvoices('c1', { page: 1, limit: 20 });

      expect(result).toEqual(expected);
    });
  });

  describe('recordPayment', () => {
    it('should record a payment', async () => {
      const expected = { id: 'pay1', amount: 500 };
      mockFinanceService.recordPayment.mockResolvedValue(expected);

      const result = await controller.recordPayment('c1', 'inv1', {
        amount: 500,
        method: 'BANK_TRANSFER',
      });

      expect(result).toEqual(expected);
    });
  });

  describe('postInvoice', () => {
    it('should post an invoice (no taxCodeId/taxRate param)', async () => {
      const expected = { id: 'inv1', postingStatus: 'POSTED' };
      mockFinanceService.postInvoice.mockResolvedValue(expected);

      const result = await controller.postInvoice(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'inv1',
      );

      expect(result).toEqual(expected);
      expect(mockFinanceService.postInvoice).toHaveBeenCalledWith(
        'c1',
        'inv1',
        'u1',
      );
    });
  });

  describe('getDlq', () => {
    it('should list DLQ items', async () => {
      const expected = [{ id: 'dlq1' }];
      mockFinanceDlqService.list.mockResolvedValue(expected);

      const result = await controller.getDlq('10');

      expect(result).toEqual(expected);
      expect(mockFinanceDlqService.list).toHaveBeenCalledWith(10);
    });
  });

  describe('retryDlq', () => {
    it('should retry pending DLQ items', async () => {
      const expected = { retried: 5 };
      mockFinanceDlqService.retryPending.mockResolvedValue(expected);

      const result = await controller.retryDlq({ limit: 10 });

      expect(result).toEqual(expected);
      expect(mockFinanceDlqService.retryPending).toHaveBeenCalledWith(10);
    });
  });

  describe('reverseJournalEntry', () => {
    it('should reverse a journal entry', async () => {
      const expected = { original: { id: 'je1' }, reversal: { id: 'je2' } };
      mockAccountingService.reverseJournalEntry.mockResolvedValue(expected);

      const result = await controller.reverseJournalEntry(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'je1',
        { reason: '录入错误' },
      );

      expect(result).toEqual(expected);
      expect(mockAccountingService.reverseJournalEntry).toHaveBeenCalledWith(
        'c1',
        'je1',
        'u1',
        '录入错误',
      );
    });
  });

  describe('getTrialBalance', () => {
    it('should return trial balance', async () => {
      const expected = { rows: [], summary: { isBalanced: true } };
      mockAccountingService.getTrialBalance.mockResolvedValue(expected);

      const result = await controller.getTrialBalance('c1');

      expect(result).toEqual(expected);
      expect(mockAccountingService.getTrialBalance).toHaveBeenCalledWith(
        'c1',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('getJournalEntries', () => {
    it('should return journal entries', async () => {
      const expected = { data: [], total: 0 };
      mockFinanceService.getJournalEntries.mockResolvedValue(expected);

      const result = await controller.getJournalEntries(
        'c1',
        { page: 1, limit: 20 },
      );

      expect(result).toEqual(expected);
    });
  });
});
