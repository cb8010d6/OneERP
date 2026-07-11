import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PresalesService } from './presales.service';

describe('PresalesService', () => {
  const tx = {
    partner: {
      findFirst: jest.fn(),
    },
    documentSequence: {
      upsert: jest.fn(),
    },
    customerRequirement: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    requirementActivity: {
      create: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    quote: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
    ),
    customerRequirement: {
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.CustomerRequirementFindManyArgs]
      >(),
      count: jest.fn<Promise<number>, [Prisma.CustomerRequirementCountArgs]>(),
    },
  };

  let service: PresalesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-11T09:00:00+08:00'));
    jest.clearAllMocks();
    service = new PresalesService(
      prisma as unknown as ConstructorParameters<typeof PresalesService>[0],
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a draft customer requirement with a company-scoped annual number', async () => {
    tx.partner.findFirst.mockResolvedValue({
      id: 'partner-1',
      name: '示例客户',
      type: 'CUSTOMER',
    });
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 1 });
    tx.customerRequirement.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'requirement-1',
        ...data,
      }),
    );
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const result = await service.createRequirement('company-1', 'user-1', {
      partnerId: 'partner-1',
      sourceChannel: '客户来电',
      summary: '需要定制一批设备零件',
    });

    expect(result).toMatchObject({
      id: 'requirement-1',
      requirementNo: 'REQ-2026-000001',
      companyId: 'company-1',
      partnerId: 'partner-1',
      ownerId: 'user-1',
      status: 'DRAFT',
    });
  });

  it('lists customer requirements within the current company', async () => {
    prisma.customerRequirement.findMany.mockResolvedValue([
      {
        id: 'requirement-1',
        requirementNo: 'REQ-2026-000001',
        companyId: 'company-1',
        status: 'DRAFT',
      },
    ]);
    prisma.customerRequirement.count.mockResolvedValue(1);

    const result = await service.listRequirements('company-1', {
      page: 1,
      limit: 20,
      search: '设备',
      status: 'DRAFT',
    });

    expect(result).toMatchObject({
      data: [{ id: 'requirement-1', companyId: 'company-1' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    const [findManyArgs] = prisma.customerRequirement.findMany.mock.calls[0];
    expect(findManyArgs.where).toMatchObject({ companyId: 'company-1' });
    expect(findManyArgs.include).toMatchObject({
      quotes: {
        take: 1,
        select: { versions: { take: 1 } },
      },
    });
  });

  it('creates Quote V1 from a company-scoped requirement and freezes ownership', async () => {
    tx.customerRequirement.findFirst.mockResolvedValue({
      id: 'requirement-1',
      companyId: 'company-1',
      partnerId: 'partner-1',
      ownerId: 'owner-1',
      status: 'FOLLOWING',
    });
    tx.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        sku: 'P-001',
        name: '精密零件',
        uom: 'pcs',
        listPrice: 80,
      },
    ]);
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 1 });
    tx.quote.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'quote-1',
        ...data,
      }),
    );
    tx.auditLog.create.mockResolvedValue({ id: 'audit-quote-1' });

    const result = await service.createQuoteFromRequirement(
      'company-1',
      'operator-1',
      'requirement-1',
      {
        currencyCode: 'CNY',
        validUntil: '2026-08-10',
        items: [{ productId: 'product-1', quantity: 2, unitPrice: 100 }],
      },
    );

    expect(result).toMatchObject({
      id: 'quote-1',
      quoteNo: 'QT-2026-000001',
      companyId: 'company-1',
      requirementId: 'requirement-1',
      partnerId: 'partner-1',
      ownerId: 'owner-1',
      currentVersionNo: 1,
    });
    const [createArgs] = tx.quote.create.mock.calls[0] as unknown as [
      {
        data: {
          versions: {
            create: Record<string, unknown>;
          };
        };
      },
    ];
    const version = createArgs.data.versions.create;
    expect(version).toMatchObject({
      versionNo: 1,
      status: 'DRAFT',
      currencyCode: 'CNY',
      baseCurrencyCode: 'CNY',
      exchangeRateSource: 'SYSTEM_BASE',
    });
    expect(String(version.exchangeRate)).toBe('1');
    expect(String(version.subtotal)).toBe('200');
    expect(String(version.taxTotal)).toBe('0');
    expect(String(version.total)).toBe('200');
    expect(tx.customerRequirement.update).toHaveBeenCalledWith({
      where: { id: 'requirement-1' },
      data: { status: 'QUOTING' },
    });
    const [auditArgs] = tx.auditLog.create.mock.calls.at(-1) as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(auditArgs.data).toMatchObject({
      userId: 'operator-1',
      companyId: 'company-1',
      entity: 'quote',
      entityId: 'quote-1',
      action: 'QUOTE_V1_CREATED',
    });
  });

  it('rejects non-CNY quote creation until an exchange-rate provider is configured', async () => {
    await expect(
      service.createQuoteFromRequirement(
        'company-1',
        'operator-1',
        'requirement-1',
        {
          currencyCode: 'USD',
          validUntil: '2026-08-10',
          items: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects quote creation from a terminal requirement', async () => {
    tx.customerRequirement.findFirst.mockResolvedValue({
      id: 'requirement-1',
      companyId: 'company-1',
      partnerId: 'partner-1',
      ownerId: 'owner-1',
      status: 'LOST',
    });

    await expect(
      service.createQuoteFromRequirement(
        'company-1',
        'operator-1',
        'requirement-1',
        {
          currencyCode: 'CNY',
          validUntil: '2026-08-10',
          items: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.quote.create).not.toHaveBeenCalled();
  });

  it('rejects a second quote header for the same requirement', async () => {
    tx.customerRequirement.findFirst.mockResolvedValue({
      id: 'requirement-1',
      companyId: 'company-1',
      partnerId: 'partner-1',
      ownerId: 'owner-1',
      status: 'QUOTING',
    });
    tx.quote.findFirst.mockResolvedValue({ id: 'quote-existing' });

    await expect(
      service.createQuoteFromRequirement(
        'company-1',
        'operator-1',
        'requirement-1',
        {
          currencyCode: 'CNY',
          validUntil: '2026-08-10',
          items: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.quote.create).not.toHaveBeenCalled();
  });

  it('adds an immutable follow-up and advances a draft requirement', async () => {
    tx.customerRequirement.findFirst.mockResolvedValue({
      id: 'requirement-1',
      companyId: 'company-1',
      status: 'DRAFT',
    });
    tx.requirementActivity.create.mockResolvedValue({
      id: 'activity-1',
      requirementId: 'requirement-1',
      content: '客户确认了技术参数，周一再次联系',
    });
    tx.customerRequirement.update.mockResolvedValue({
      id: 'requirement-1',
      status: 'FOLLOWING',
      nextFollowUpAt: new Date('2026-07-13T01:00:00.000Z'),
    });
    tx.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    const result = await service.addFollowUp(
      'company-1',
      'user-1',
      'requirement-1',
      {
        content: '客户确认了技术参数，周一再次联系',
        nextFollowUpAt: '2026-07-13T09:00:00+08:00',
      },
    );

    expect(result).toMatchObject({
      requirement: { id: 'requirement-1', status: 'FOLLOWING' },
      activity: { id: 'activity-1', requirementId: 'requirement-1' },
    });
  });

  it('rejects a lost requirement without a close reason', async () => {
    await expect(
      service.closeRequirement('company-1', 'user-1', 'requirement-1', {
        status: 'LOST',
        reason: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('closes an active requirement and preserves the reason', async () => {
    tx.customerRequirement.findFirst.mockResolvedValue({
      id: 'requirement-1',
      companyId: 'company-1',
      status: 'FOLLOWING',
    });
    tx.customerRequirement.update.mockResolvedValue({
      id: 'requirement-1',
      status: 'LOST',
      closeReason: '预算取消',
      nextFollowUpAt: null,
    });
    tx.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    const result = await service.closeRequirement(
      'company-1',
      'user-1',
      'requirement-1',
      { status: 'LOST', reason: '预算取消' },
    );

    expect(result).toMatchObject({
      id: 'requirement-1',
      status: 'LOST',
      closeReason: '预算取消',
    });
  });
});
