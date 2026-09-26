import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { AccountingService } from './accounting.service';

function setup() {
  const payload = {
    companyId: 'c1',
    transactionId: 'move1',
    idempotencyKey: 'stock_depleted:move1',
    materialId: 'm1',
    quantity: 2,
    referenceNo: 'SALE-SHIP-1',
    unitCost: 8,
  };
  const movement = {
    id: 'move1',
    companyId: 'c1',
    materialId: 'm1',
    quantity: new Decimal(2),
    referenceNo: 'SALE-SHIP-1',
    operatorId: 'u1',
    destLocationId: null,
    sourceLocation: { companyId: 'c1' },
    material: { companyId: 'c1', name: 'Steel', unitPrice: new Decimal(12.5) },
  };
  const snapshot: Record<string, unknown> = { ...payload };
  const entry = {
    id: 'entry1',
    companyId: 'c1',
    ref: 'SALE-SHIP-1',
    inventoryTransactionId: 'move1',
    postingStatus: 'POSTED',
    journal: { code: 'INV' },
    lines: [
      { debit: new Decimal(16), credit: new Decimal(0) },
      { debit: new Decimal(0), credit: new Decimal(16) },
    ],
  };
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    inventoryTransaction: { findFirst: jest.fn().mockResolvedValue(movement) },
    eventDlq: {
      findMany: jest.fn().mockResolvedValue([{ payload: snapshot }]),
    },
    materialCost: { findUnique: jest.fn().mockResolvedValue(null) },
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(entry),
    },
    journal: { upsert: jest.fn().mockResolvedValue({ id: 'journal1' }) },
    account: {
      findFirst: jest
        .fn()
        .mockImplementation((args: { where: { code: string } }) =>
          Promise.resolve({ id: args.where.code }),
        ),
    },
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    journal: { upsert: jest.fn() },
  };
  const mappings = {
    ensureDefaultAccounts: jest.fn(),
    resolveLineAccount: jest
      .fn()
      .mockImplementation((_companyId: string, key: string) =>
        Promise.resolve({
          accountCode: key === 'COGS' ? '6401X' : '1405X',
          accountName: key,
          accountType: key === 'COGS' ? 'EXPENSE' : 'ASSET',
        }),
      ),
  };
  const periods = { assertOpenForDate: jest.fn() };
  return {
    service: new AccountingService(
      prisma as never,
      mappings as never,
      periods as never,
    ),
    tx,
    prisma,
    mappings,
    periods,
    payload,
    snapshot,
    movement,
    entry,
  };
}

describe('AccountingService stock movement accounting', () => {
  it('posts saved movement cost to configured accounts with the original business reference', async () => {
    const { service, tx, mappings, payload, periods } = setup();
    expect((await service.postStockDepletedEntry(payload))?.totals).toEqual({
      debit: 16,
      credit: 16,
    });
    expect(tx.materialCost.findUnique).not.toHaveBeenCalled();
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'COGS',
      undefined,
      tx,
    );
    expect(mappings.resolveLineAccount).toHaveBeenCalledWith(
      'c1',
      'INVENTORY',
      undefined,
      tx,
    );
    expect(mappings.ensureDefaultAccounts).toHaveBeenCalledWith('c1', tx);
    expect(periods.assertOpenForDate).toHaveBeenCalledWith(
      'c1',
      expect.any(Date),
      tx,
    );
    expect(tx.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inventoryTransactionId: 'move1',
          ref: 'SALE-SHIP-1',
          createdBy: 'u1',
          lines: {
            create: [
              expect.objectContaining({
                accountId: '6401X',
                debit: new Decimal(16),
                credit: new Decimal(0),
              }),
              expect.objectContaining({
                accountId: '1405X',
                debit: new Decimal(0),
                credit: new Decimal(16),
              }),
            ],
          },
        }) as unknown,
      }),
    );
  });

  it.each([null, { averageCost: new Decimal(18) }])(
    'retains the legacy fallback only for a saved snapshot without cost: %j',
    async (cost) => {
      const { service, tx, payload, snapshot } = setup();
      delete snapshot.unitCost;
      tx.materialCost.findUnique.mockResolvedValue(cost);
      const result = await service.postStockDepletedEntry({
        ...payload,
        unitCost: undefined,
      });
      expect(result?.totals.debit).toBe(cost ? 36 : 25);
      expect(tx.materialCost.findUnique).toHaveBeenCalledWith({
        where: { companyId_materialId: { companyId: 'c1', materialId: 'm1' } },
        select: { averageCost: true },
      });
    },
  );

  it.each([-1, Number.NaN])(
    'rejects an invalid legacy fallback cost %j rather than treating it as zero',
    async (cost) => {
      const { service, tx, payload, snapshot, movement } = setup();
      delete snapshot.unitCost;
      tx.materialCost.findUnique.mockResolvedValueOnce({
        averageCost: new Decimal(cost),
      });
      await expect(
        service.postStockDepletedEntry({ ...payload, unitCost: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
      movement.material.unitPrice = new Decimal(cost);
      await expect(
        service.postStockDepletedEntry({ ...payload, unitCost: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.journalEntry.create).not.toHaveBeenCalled();
    },
  );

  it('waits for the journal lock before reading identity or cost', async () => {
    const { service, tx, payload } = setup();
    let release!: () => void;
    tx.$executeRawUnsafe.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const posting = service.postStockDepletedEntry(payload);
    expect(tx.inventoryTransaction.findFirst).not.toHaveBeenCalled();
    release();
    await posting;
    expect(tx.inventoryTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'move1', companyId: 'c1', type: 'OUTBOUND' },
      }),
    );
  });

  it('returns the existing movement receipt without posting or rechecking a closed period', async () => {
    const { service, tx, periods, payload, entry } = setup();
    tx.journalEntry.findFirst.mockResolvedValue(entry);
    periods.assertOpenForDate.mockRejectedValue(new Error('closed'));
    expect((await service.postStockDepletedEntry(payload))?.id).toBe(entry.id);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
    expect(periods.assertOpenForDate).not.toHaveBeenCalled();
  });

  it.each([
    { idempotencyKey: 'stock_depleted:another' },
    { companyId: '' },
    { transactionId: '' },
    { materialId: 'foreign' },
    { quantity: 3 },
    { quantity: Number.NaN },
    { referenceNo: 'other-ref' },
    { unitCost: 99 },
  ])('rejects mismatched incoming event identity/value: %j', async (patch) => {
    const { service, tx, payload } = setup();
    await expect(
      service.postStockDepletedEntry({ ...payload, ...patch }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'sourceLocation', 'material'] as const)(
    'rejects a foreign %s boundary',
    async (field) => {
      const { service, tx, payload, movement } = setup();
      if (field === 'companyId')
        tx.inventoryTransaction.findFirst.mockResolvedValue(null);
      else movement[field].companyId = 'c2';
      await expect(
        service.postStockDepletedEntry(payload),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.journalEntry.create).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', null, -1, 'Infinity'])(
    'rejects invalid saved cost %j',
    async (cost) => {
      const { service, tx, payload, snapshot } = setup();
      snapshot.unitCost = cost;
      await expect(
        service.postStockDepletedEntry(payload),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.journalEntry.create).not.toHaveBeenCalled();
    },
  );

  it('rejects missing or conflicting persisted events instead of trusting incoming cost', async () => {
    const { service, tx, payload, snapshot } = setup();
    tx.eventDlq.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { payload: snapshot },
        { payload: { ...snapshot, unitCost: 9 } },
      ]);
    await expect(
      service.postStockDepletedEntry(payload),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.postStockDepletedEntry(payload),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('does not guess which movement a legacy reference-only journal belongs to', async () => {
    const { service, tx, payload, entry } = setup();
    tx.journalEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(entry);
    await expect(service.postStockDepletedEntry(payload)).rejects.toThrow(
      '历史凭证',
    );
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it('retains zero-snapshot behavior even when current material price is positive', async () => {
    const { service, tx, payload, snapshot } = setup();
    snapshot.unitCost = 0;
    expect(
      await service.postStockDepletedEntry({ ...payload, unitCost: 0 }),
    ).toBeNull();
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
    expect(tx.materialCost.findUnique).not.toHaveBeenCalled();
  });

  it('propagates period and account validation failures without a receipt', async () => {
    const { service, tx, payload, periods } = setup();
    periods.assertOpenForDate.mockRejectedValueOnce(
      new BadRequestException('closed period'),
    );
    await expect(service.postStockDepletedEntry(payload)).rejects.toThrow(
      'closed period',
    );
    tx.account.findFirst.mockResolvedValue(null);
    await expect(service.postStockDepletedEntry(payload)).rejects.toThrow(
      '会计科目不存在或已停用',
    );
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });
});
