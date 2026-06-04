import { BadRequestException } from '@nestjs/common';
import { FinanceAccountMappingService } from './finance-account-mapping.service';

function createService() {
  const prisma = {
    financeAccountMapping: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    account: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
  };
  return {
    service: new FinanceAccountMappingService(prisma as never),
    prisma,
  };
}

describe('FinanceAccountMappingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists all required mapping definitions with selected accounts', async () => {
    const { service, prisma } = createService();
    prisma.account.upsert.mockResolvedValue({});
    prisma.financeAccountMapping.findMany.mockResolvedValue([
      {
        key: 'RECEIVABLE',
        account: { id: 'a1', code: '1122X', name: '自定义应收' },
      },
    ]);

    const result = await service.list('c1');

    expect(result.map((item) => item.key)).toContain('RECEIVABLE');
    expect(result.map((item) => item.key)).toContain('SALES_REVENUE');
    expect(result.find((item) => item.key === 'RECEIVABLE')?.account).toEqual({
      id: 'a1',
      code: '1122X',
      name: '自定义应收',
    });
  });

  it('lists active account options after ensuring default accounts', async () => {
    const { service, prisma } = createService();
    const expected = [
      { id: 'a1', code: '6001', name: '主营业务收入', type: 'REVENUE' },
    ];
    prisma.account.upsert.mockResolvedValue({});
    prisma.account.findMany.mockResolvedValue(expected);

    await expect(service.listAccountOptions('c1')).resolves.toBe(expected);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', isActive: true },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
      },
    });
  });

  it('does not overwrite existing default account names or types', async () => {
    const { service, prisma } = createService();
    prisma.account.upsert.mockResolvedValue({});

    await service.ensureDefaultAccounts('c1');

    expect(prisma.account.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_code: { companyId: 'c1', code: '6001' } },
        update: { isActive: true },
      }),
    );
  });

  it('rejects unsupported mapping keys', async () => {
    const { service } = createService();

    await expect(
      service.update('c1', {
        mappings: [{ key: 'UNKNOWN', accountId: 'a1' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves configured accounts before fallback accounts', async () => {
    const { service, prisma } = createService();
    prisma.financeAccountMapping.findUnique.mockResolvedValue({
      account: {
        code: '6001X',
        name: '定制收入',
        type: 'REVENUE',
        isActive: true,
      },
    });

    const result = await service.resolveLineAccount('c1', 'SALES_REVENUE');

    expect(result).toEqual({
      accountCode: '6001X',
      accountName: '定制收入',
      accountType: 'REVENUE',
    });
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });
});
