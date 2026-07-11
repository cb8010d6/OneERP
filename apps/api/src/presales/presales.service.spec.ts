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
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    quoteVersion: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    salesContract: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    salesContractVersion: {
      updateMany: jest.fn(),
    },
    salesContractApproval: {
      create: jest.fn(),
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

  it('copies the current sent version into a new draft V2', async () => {
    tx.quote.findFirst.mockResolvedValue({
      id: 'quote-1',
      companyId: 'company-1',
      currentVersionNo: 1,
      versions: [
        {
          id: 'version-1',
          versionNo: 1,
          status: 'SENT',
          currencyCode: 'CNY',
          baseCurrencyCode: 'CNY',
          exchangeRate: 1,
          exchangeRateAt: new Date('2026-07-11T01:00:00.000Z'),
          exchangeRateSource: 'SYSTEM_BASE',
          validUntil: new Date('2026-08-10T00:00:00.000Z'),
          paymentTerms: '预付 30%',
          deliveryTerms: '送货上门',
          subtotal: 200,
          taxTotal: 0,
          total: 200,
          items: [
            {
              productId: 'product-1',
              skuSnapshot: 'P-001',
              nameSnapshot: '精密零件',
              uomSnapshot: 'pcs',
              quantity: 2,
              unitPrice: 100,
              discountRate: 0,
              taxRate: 0,
              netAmount: 200,
              taxAmount: 0,
              grossAmount: 200,
            },
          ],
        },
      ],
    });
    tx.quoteVersion.create.mockResolvedValue({
      id: 'version-2',
      quoteId: 'quote-1',
      versionNo: 2,
      status: 'DRAFT',
    });
    tx.quote.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.createQuoteVersion(
      'company-1',
      'operator-1',
      'quote-1',
    );

    expect(result).toMatchObject({
      id: 'version-2',
      versionNo: 2,
      status: 'DRAFT',
    });
    const [createArgs] = tx.quoteVersion.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data).toMatchObject({
      quoteId: 'quote-1',
      companyId: 'company-1',
      versionNo: 2,
      status: 'DRAFT',
    });
    expect(tx.quote.updateMany).toHaveBeenCalledWith({
      where: { id: 'quote-1', companyId: 'company-1', currentVersionNo: 1 },
      data: { currentVersionNo: 2 },
    });
  });

  it('sends V2 once and supersedes the older sent version', async () => {
    tx.quoteVersion.findFirst
      .mockResolvedValueOnce({
        id: 'version-2',
        quoteId: 'quote-1',
        companyId: 'company-1',
        versionNo: 2,
        status: 'DRAFT',
        validUntil: new Date('2026-08-10T00:00:00.000Z'),
        quote: { currentVersionNo: 2 },
        items: [{ id: 'item-2' }],
      })
      .mockResolvedValueOnce({
        id: 'version-2',
        versionNo: 2,
        status: 'SENT',
      });
    tx.quoteVersion.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await service.sendQuoteVersion(
      'company-1',
      'operator-1',
      'version-2',
    );

    expect(result).toMatchObject({ id: 'version-2', status: 'SENT' });
    expect(tx.quoteVersion.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          quoteId: 'quote-1',
          companyId: 'company-1',
          status: 'SENT',
          versionNo: { lt: 2 },
        },
        data: { status: 'SUPERSEDED' },
      }),
    );
  });

  it('records an accepted customer decision only from SENT', async () => {
    tx.quoteVersion.findFirst
      .mockResolvedValueOnce({
        id: 'version-2',
        quoteId: 'quote-1',
        companyId: 'company-1',
        versionNo: 2,
        status: 'SENT',
      })
      .mockResolvedValueOnce({
        id: 'version-2',
        versionNo: 2,
        status: 'ACCEPTED',
      });
    tx.quoteVersion.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.recordQuoteDecision(
      'company-1',
      'operator-1',
      'version-2',
      'ACCEPTED',
    );

    expect(result).toMatchObject({ id: 'version-2', status: 'ACCEPTED' });
    const [decisionArgs] = tx.quoteVersion.updateMany.mock
      .calls[0] as unknown as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(decisionArgs.where).toEqual({
      id: 'version-2',
      companyId: 'company-1',
      status: 'SENT',
    });
    expect(decisionArgs.data).toMatchObject({ status: 'ACCEPTED' });
  });

  it('creates Contract V1 from a unique accepted quote version snapshot', async () => {
    tx.quoteVersion.findFirst.mockResolvedValue({
      id: 'version-2',
      companyId: 'company-1',
      versionNo: 2,
      status: 'ACCEPTED',
      currencyCode: 'CNY',
      baseCurrencyCode: 'CNY',
      exchangeRate: 1,
      exchangeRateAt: new Date('2026-07-11T01:00:00.000Z'),
      exchangeRateSource: 'SYSTEM_BASE',
      paymentTerms: '到货付款',
      deliveryTerms: '送货上门',
      total: 250,
      quote: {
        id: 'quote-1',
        partnerId: 'partner-1',
        ownerId: 'owner-1',
      },
    });
    tx.salesContract.findFirst.mockResolvedValue(null);
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 1 });
    tx.salesContract.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'contract-1',
        ...data,
      }),
    );

    const result = await service.createContractFromQuoteVersion(
      'company-1',
      'operator-1',
      'version-2',
      { title: '设备零件销售合同' },
    );

    expect(result).toMatchObject({
      id: 'contract-1',
      contractNo: 'CT-2026-000001',
      companyId: 'company-1',
      quoteVersionId: 'version-2',
      partnerId: 'partner-1',
      ownerId: 'owner-1',
      status: 'DRAFT',
      currentVersionNo: 1,
    });
    const [contractAuditArgs] = tx.auditLog.create.mock.calls.at(
      -1,
    ) as unknown as [{ data: Record<string, unknown> }];
    expect(contractAuditArgs.data).toMatchObject({
      action: 'CONTRACT_V1_CREATED',
      entity: 'salesContract',
      entityId: 'contract-1',
    });
  });

  it('submits a draft contract to sales manager approval', async () => {
    tx.salesContract.findFirst.mockResolvedValue({
      id: 'contract-1',
      contractNo: 'CT-2026-000001',
      status: 'DRAFT',
      currentVersionNo: 1,
    });
    tx.salesContract.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractApproval.create.mockResolvedValue({ id: 'approval-1' });

    const result = await service.submitContract(
      'company-1',
      'sales-1',
      'contract-1',
    );

    expect(result).toMatchObject({ status: 'PENDING_SALES_MANAGER' });
    const [approvalArgs] = tx.salesContractApproval.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(approvalArgs.data).toMatchObject({
      stage: 'SALES_SUBMISSION',
      decision: 'SUBMITTED',
    });
  });

  it('approves a contract below the threshold after sales manager review', async () => {
    tx.salesContract.findFirst.mockResolvedValue({
      id: 'contract-1',
      contractNo: 'CT-2026-000001',
      status: 'PENDING_SALES_MANAGER',
      currentVersionNo: 1,
      versions: [{ versionNo: 1, total: 99999.99 }],
    });
    tx.salesContract.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractApproval.create.mockResolvedValue({ id: 'approval-2' });

    const result = await service.decideContract(
      'company-1',
      'manager-1',
      'contract-1',
      'SALES_MANAGER',
      { decision: 'APPROVE' },
    );

    expect(result).toMatchObject({ status: 'APPROVED' });
    expect(tx.salesContractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'APPROVED' } }),
    );
  });

  it('routes a contract at the threshold through finance and business review', async () => {
    tx.salesContract.findFirst
      .mockResolvedValueOnce({
        id: 'contract-1',
        contractNo: 'CT-2026-000001',
        status: 'PENDING_SALES_MANAGER',
        currentVersionNo: 1,
        versions: [{ versionNo: 1, total: 100000 }],
      })
      .mockResolvedValueOnce({
        id: 'contract-1',
        contractNo: 'CT-2026-000001',
        status: 'PENDING_FINANCE_REVIEW',
        currentVersionNo: 1,
        versions: [{ versionNo: 1, total: 100000 }],
      })
      .mockResolvedValueOnce({
        id: 'contract-1',
        contractNo: 'CT-2026-000001',
        status: 'PENDING_BUSINESS_REVIEW',
        currentVersionNo: 1,
        versions: [{ versionNo: 1, total: 100000 }],
      });
    tx.salesContract.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.salesContractApproval.create.mockResolvedValue({ id: 'approval' });

    const manager = await service.decideContract(
      'company-1',
      'manager-1',
      'contract-1',
      'SALES_MANAGER',
      { decision: 'APPROVE' },
    );
    const finance = await service.decideContract(
      'company-1',
      'finance-1',
      'contract-1',
      'FINANCE',
      { decision: 'APPROVE' },
    );
    const business = await service.decideContract(
      'company-1',
      'business-1',
      'contract-1',
      'BUSINESS',
      { decision: 'APPROVE' },
    );

    expect(manager).toMatchObject({ status: 'PENDING_FINANCE_REVIEW' });
    expect(finance).toMatchObject({ status: 'PENDING_BUSINESS_REVIEW' });
    expect(business).toMatchObject({ status: 'APPROVED' });
  });

  it('requires a reason when rejecting a contract', async () => {
    await expect(
      service.decideContract(
        'company-1',
        'manager-1',
        'contract-1',
        'SALES_MANAGER',
        { decision: 'REJECT' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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
