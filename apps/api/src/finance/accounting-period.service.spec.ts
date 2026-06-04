import { BadRequestException } from '@nestjs/common';
import { AccountingPeriodStatus } from '@prisma/client';
import { AccountingPeriodService } from './accounting-period.service';

function createService() {
  const prisma = {
    accountingPeriod: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    invoice: { count: jest.fn() },
    payment: { count: jest.fn() },
    creditNote: { count: jest.fn() },
    customerRefund: { count: jest.fn() },
    purchaseInvoice: { count: jest.fn() },
    supplierCreditNote: { count: jest.fn() },
    supplierPayment: { count: jest.fn() },
    eventDlq: { count: jest.fn() },
  };
  return {
    service: new AccountingPeriodService(prisma as never),
    prisma,
  };
}

describe('AccountingPeriodService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockCloseBlockerCounts(
    prisma: ReturnType<typeof createService>['prisma'],
    counts: Partial<{
      invoices: number;
      customerPayments: number;
      creditNotes: number;
      customerRefunds: number;
      purchaseInvoices: number;
      supplierCreditNotes: number;
      supplierPayments: number;
      financeEvents: number;
    }> = {},
  ) {
    prisma.invoice.count.mockResolvedValue(counts.invoices ?? 0);
    prisma.payment.count.mockResolvedValue(counts.customerPayments ?? 0);
    prisma.creditNote.count.mockResolvedValue(counts.creditNotes ?? 0);
    prisma.customerRefund.count.mockResolvedValue(counts.customerRefunds ?? 0);
    prisma.purchaseInvoice.count.mockResolvedValue(
      counts.purchaseInvoices ?? 0,
    );
    prisma.supplierCreditNote.count.mockResolvedValue(
      counts.supplierCreditNotes ?? 0,
    );
    prisma.supplierPayment.count.mockResolvedValue(
      counts.supplierPayments ?? 0,
    );
    prisma.eventDlq.count.mockResolvedValue(counts.financeEvents ?? 0);
  }

  it('rejects overlapping accounting periods', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      periodKey: '2026-06',
    });

    await expect(
      service.upsert('c1', {
        periodKey: '2026-07',
        startDate: '2026-06-25',
        endDate: '2026-07-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists periods with close blocker counts', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findMany.mockResolvedValue([
      {
        id: 'ap-1',
        periodKey: '2026-06',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-30'),
        status: AccountingPeriodStatus.OPEN,
      },
    ]);
    mockCloseBlockerCounts(prisma, {
      invoices: 1,
      customerPayments: 2,
      financeEvents: 1,
    });

    const result = (await service.list('c1')) as Array<{
      id: string;
      closeBlockerTotal: number;
      closeBlockers: {
        invoices: number;
        customerPayments: number;
        financeEvents: number;
      };
    }>;

    expect(result[0]?.id).toBe('ap-1');
    expect(result[0]?.closeBlockerTotal).toBe(4);
    expect(result[0]?.closeBlockers.invoices).toBe(1);
    expect(result[0]?.closeBlockers.customerPayments).toBe(2);
    expect(result[0]?.closeBlockers.financeEvents).toBe(1);
  });

  it('creates an open accounting period when the date range is valid', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findFirst.mockResolvedValue(null);
    prisma.accountingPeriod.upsert.mockResolvedValue({ id: 'ap-1' });

    await expect(
      service.upsert('c1', {
        periodKey: '2026-06',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    ).resolves.toEqual({ id: 'ap-1' });

    const upsertMock = prisma.accountingPeriod.upsert as jest.MockedFunction<
      (input: unknown) => unknown
    >;
    const upsertInput = upsertMock.mock.calls[0]?.[0] as
      | { create?: { companyId?: string; periodKey?: string; status?: string } }
      | undefined;
    expect(upsertInput?.create).toEqual(
      expect.objectContaining({
        companyId: 'c1',
        periodKey: '2026-06',
        status: AccountingPeriodStatus.OPEN,
      }),
    );
  });

  it('blocks posting into a closed accounting period', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      periodKey: '2026-06',
      status: AccountingPeriodStatus.CLOSED,
    });

    await expect(
      service.assertOpenForDate('c1', new Date('2026-06-15')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows posting when no period has been configured for the date', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findFirst.mockResolvedValue(null);

    await expect(
      service.assertOpenForDate('c1', new Date('2026-06-15')),
    ).resolves.toBeUndefined();
  });

  it('rejects closing a period with unposted documents or finance events', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'ap-1',
      periodKey: '2026-06',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      status: AccountingPeriodStatus.OPEN,
    });
    mockCloseBlockerCounts(prisma, {
      invoices: 2,
      purchaseInvoices: 1,
      financeEvents: 1,
    });

    await expect(service.close('c1', '2026-06', 'u1')).rejects.toThrow(
      '未完成财务事项',
    );
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
  });

  it('closes a period only when there are no posting blockers', async () => {
    const { service, prisma } = createService();
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'ap-1',
      periodKey: '2026-06',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      status: AccountingPeriodStatus.OPEN,
    });
    mockCloseBlockerCounts(prisma);
    prisma.accountingPeriod.update.mockResolvedValue({
      id: 'ap-1',
      status: AccountingPeriodStatus.CLOSED,
    });

    await expect(service.close('c1', '2026-06', 'u1')).resolves.toEqual({
      id: 'ap-1',
      status: AccountingPeriodStatus.CLOSED,
    });
    const updateMock = prisma.accountingPeriod.update as jest.MockedFunction<
      (input: unknown) => unknown
    >;
    const updateInput = updateMock.mock.calls[0]?.[0] as
      | {
          where?: { id?: string };
          data?: { status?: string; closedBy?: string };
        }
      | undefined;
    expect(updateInput?.where).toEqual({ id: 'ap-1' });
    expect(updateInput?.data).toEqual(
      expect.objectContaining({
        status: AccountingPeriodStatus.CLOSED,
        closedBy: 'u1',
      }),
    );
  });
});
