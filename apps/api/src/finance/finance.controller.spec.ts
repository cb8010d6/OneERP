import { Test, TestingModule } from '@nestjs/testing';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceDlqService } from './finance-dlq.service';
import { FinanceAccountMappingService } from './finance-account-mapping.service';
import { AccountingPeriodService } from './accounting-period.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';

describe('FinanceController', () => {
  let controller: FinanceController;

  const mockFinanceService = {
    createInvoice: jest.fn(),
    getInvoices: jest.fn(),
    recordPayment: jest.fn(),
    recordReceivablePayment: jest.fn(),
    applyReceivablePayment: jest.fn(),
    createCreditNote: jest.fn(),
    getCreditNotes: jest.fn(),
    postCreditNote: jest.fn(),
    createCustomerRefund: jest.fn(),
    getCustomerRefunds: jest.fn(),
    postCustomerRefund: jest.fn(),
    postInvoice: jest.fn(),
    getIncomeStatement: jest.fn(),
    getReceivableAging: jest.fn(),
    getUnappliedPayments: jest.fn(),
  };

  const mockFinanceDlqService = {
    list: jest.fn(),
    retryPending: jest.fn(),
  };

  const mockFinanceAccountMappingService = {
    list: jest.fn(),
    listAccountOptions: jest.fn(),
    update: jest.fn(),
  };

  const mockAccountingPeriodService = {
    list: jest.fn(),
    upsert: jest.fn(),
    close: jest.fn(),
    reopen: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
        { provide: FinanceDlqService, useValue: mockFinanceDlqService },
        {
          provide: FinanceAccountMappingService,
          useValue: mockFinanceAccountMappingService,
        },
        {
          provide: AccountingPeriodService,
          useValue: mockAccountingPeriodService,
        },
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
        {
          orderId: 'o1',
          amount: 1000,
          dueDate: '2025-12-31',
        },
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

      const result = await controller.recordPayment(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'inv1',
        {
          amount: 500,
          method: 'BANK_TRANSFER',
        },
      );

      expect(result).toEqual(expected);
      expect(mockFinanceService.recordPayment).toHaveBeenCalledWith(
        'c1',
        'inv1',
        { amount: 500, method: 'BANK_TRANSFER' },
        'u1',
      );
    });
  });

  describe('recordReceivablePayment', () => {
    it('should record an allocated customer payment', async () => {
      const expected = { id: 'pay1', amount: 1500 };
      const dto = {
        partnerId: 'p1',
        amount: 1500,
        method: 'BANK_TRANSFER',
        allocations: [
          { invoiceId: 'inv1', amount: 1000 },
          { invoiceId: 'inv2', amount: 500 },
        ],
      };
      mockFinanceService.recordReceivablePayment.mockResolvedValue(expected);

      const result = await controller.recordReceivablePayment(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        dto,
      );

      expect(result).toEqual(expected);
      expect(mockFinanceService.recordReceivablePayment).toHaveBeenCalledWith(
        'c1',
        dto,
        'u1',
      );
    });
  });

  describe('applyReceivablePayment', () => {
    it('should apply an existing unapplied payment to invoices', async () => {
      const expected = { paymentId: 'pay1', allocationIds: ['pa1'] };
      const dto = { allocations: [{ invoiceId: 'inv1', amount: 300 }] };
      mockFinanceService.applyReceivablePayment.mockResolvedValue(expected);

      const result = await controller.applyReceivablePayment(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'pay1',
        dto,
      );

      expect(result).toBe(expected);
      expect(mockFinanceService.applyReceivablePayment).toHaveBeenCalledWith(
        'c1',
        'pay1',
        dto,
        'u1',
      );
    });
  });

  describe('accountMappings', () => {
    it('should list and update account mappings', async () => {
      const expected = [{ key: 'RECEIVABLE' }];
      mockFinanceAccountMappingService.list.mockResolvedValue(expected);
      mockFinanceAccountMappingService.update.mockResolvedValue(expected);

      await expect(controller.getAccountMappings('c1')).resolves.toEqual(
        expected,
      );
      await expect(
        controller.updateAccountMappings('c1', {
          mappings: [{ key: 'RECEIVABLE', accountId: 'a1' }],
        }),
      ).resolves.toEqual(expected);

      expect(mockFinanceAccountMappingService.list).toHaveBeenCalledWith('c1');
      expect(mockFinanceAccountMappingService.update).toHaveBeenCalledWith(
        'c1',
        { mappings: [{ key: 'RECEIVABLE', accountId: 'a1' }] },
      );
    });

    it('should return account options', async () => {
      const expected = [{ id: 'a1', code: '6001', name: '主营业务收入' }];
      mockFinanceAccountMappingService.listAccountOptions.mockResolvedValue(
        expected,
      );

      await expect(controller.getAccountOptions('c1')).resolves.toEqual(
        expected,
      );
      expect(
        mockFinanceAccountMappingService.listAccountOptions,
      ).toHaveBeenCalledWith('c1');
    });
  });

  describe('postInvoice', () => {
    it('should post an invoice', async () => {
      const expected = { id: 'inv1', postingStatus: 'POSTED' };
      mockFinanceService.postInvoice.mockResolvedValue(expected);

      const result = await controller.postInvoice(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'inv1',
        {
          taxRate: 0.13,
        },
      );

      expect(result).toEqual(expected);
      expect(mockFinanceService.postInvoice).toHaveBeenCalledWith(
        'c1',
        'inv1',
        'u1',
        undefined,
        0.13,
      );
    });
  });

  describe('getReceivableAging', () => {
    it('should return receivable aging rows', async () => {
      const expected = { totalOpen: 100, rows: [] };
      mockFinanceService.getReceivableAging.mockResolvedValue(expected);

      const result = await controller.getReceivableAging('c1', '2026-05-31');

      expect(result).toBe(expected);
      expect(mockFinanceService.getReceivableAging).toHaveBeenCalledWith(
        'c1',
        '2026-05-31',
      );
    });
  });

  describe('getIncomeStatement', () => {
    it('should return income statement rows', async () => {
      const expected = { totalRevenue: 1000, totalExpense: 600, rows: [] };
      mockFinanceService.getIncomeStatement.mockResolvedValue(expected);

      const result = await controller.getIncomeStatement(
        'c1',
        '2026-06-01',
        '2026-06-30',
      );

      expect(result).toBe(expected);
      expect(mockFinanceService.getIncomeStatement).toHaveBeenCalledWith(
        'c1',
        '2026-06-01',
        '2026-06-30',
      );
    });
  });

  describe('getUnappliedPayments', () => {
    it('should return unapplied customer payments', async () => {
      const expected = { rows: [{ paymentId: 'pay1', unappliedAmount: 200 }] };
      mockFinanceService.getUnappliedPayments.mockResolvedValue(expected);

      const result = await controller.getUnappliedPayments('c1');

      expect(result).toBe(expected);
      expect(mockFinanceService.getUnappliedPayments).toHaveBeenCalledWith(
        'c1',
      );
    });
  });

  describe('creditNotes', () => {
    it('should create and post credit notes', async () => {
      const created = { id: 'cn1', amount: 300 };
      mockFinanceService.createCreditNote.mockResolvedValue(created);
      mockFinanceService.postCreditNote.mockResolvedValue({
        id: 'cn1',
        postingStatus: 'POSTED',
      });

      await expect(
        controller.createCreditNote(
          'c1',
          { id: 'u1', email: 'test@example.com' },
          { invoiceId: 'inv1', amount: 300, reason: '客户退货' },
        ),
      ).resolves.toEqual(created);
      expect(mockFinanceService.createCreditNote).toHaveBeenCalledWith(
        'c1',
        { invoiceId: 'inv1', amount: 300, reason: '客户退货' },
        'u1',
      );

      await expect(
        controller.postCreditNote(
          'c1',
          { id: 'u1', email: 'test@example.com' },
          'cn1',
        ),
      ).resolves.toEqual({ id: 'cn1', postingStatus: 'POSTED' });
      expect(mockFinanceService.postCreditNote).toHaveBeenCalledWith(
        'c1',
        'cn1',
        'u1',
      );
    });

    it('should list credit notes', async () => {
      const expected = { data: [{ id: 'cn1' }], total: 1 };
      mockFinanceService.getCreditNotes.mockResolvedValue(expected);

      await expect(
        controller.getCreditNotes('c1', { page: 1, limit: 20 }),
      ).resolves.toEqual(expected);
      expect(mockFinanceService.getCreditNotes).toHaveBeenCalledWith('c1', {
        page: 1,
        limit: 20,
      });
    });

    it('should create and post customer refunds', async () => {
      const created = { id: 'rf1', amount: 100 };
      mockFinanceService.createCustomerRefund.mockResolvedValue(created);
      mockFinanceService.postCustomerRefund.mockResolvedValue({
        id: 'rf1',
        postingStatus: 'POSTED',
      });

      await expect(
        controller.createCustomerRefund(
          'c1',
          { id: 'u1', email: 'test@example.com' },
          {
            creditNoteId: 'cn1',
            amount: 100,
            method: 'BANK_TRANSFER',
          },
        ),
      ).resolves.toEqual(created);
      expect(mockFinanceService.createCustomerRefund).toHaveBeenCalledWith(
        'c1',
        { creditNoteId: 'cn1', amount: 100, method: 'BANK_TRANSFER' },
        'u1',
      );

      await expect(
        controller.postCustomerRefund(
          'c1',
          { id: 'u1', email: 'test@example.com' },
          'rf1',
        ),
      ).resolves.toEqual({ id: 'rf1', postingStatus: 'POSTED' });
      expect(mockFinanceService.postCustomerRefund).toHaveBeenCalledWith(
        'c1',
        'rf1',
        'u1',
      );
    });
  });

  describe('getDlq', () => {
    it('should list DLQ items', async () => {
      const expected = [{ id: 'dlq1' }];
      mockFinanceDlqService.list.mockResolvedValue(expected);

      const result = await controller.getDlq('c1', '10');

      expect(result).toEqual(expected);
      expect(mockFinanceDlqService.list).toHaveBeenCalledWith(10, 'c1');
    });
  });

  describe('retryDlq', () => {
    it('should retry pending DLQ items', async () => {
      const expected = { retried: 5 };
      mockFinanceDlqService.retryPending.mockResolvedValue(expected);

      const result = await controller.retryDlq('c1', { limit: 10 });

      expect(result).toEqual(expected);
      expect(mockFinanceDlqService.retryPending).toHaveBeenCalledWith(
        10,
        'c1',
        undefined,
      );
    });

    it('should retry pending DLQ items scoped by event name', async () => {
      const expected = { retried: 1 };
      mockFinanceDlqService.retryPending.mockResolvedValue(expected);

      const result = await controller.retryDlq('c1', {
        limit: 10,
        eventNames: ['inventory.stock_depleted', 123],
      });

      expect(result).toEqual(expected);
      expect(mockFinanceDlqService.retryPending).toHaveBeenCalledWith(
        10,
        'c1',
        ['inventory.stock_depleted'],
      );
    });
  });
});
