import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventQueueService } from '../../src/core/events/event-queue.service';
import { AccountingService } from '../../src/finance/accounting.service';
import { AccountingPeriodService } from '../../src/finance/accounting-period.service';
import { FinanceAccountMappingService } from '../../src/finance/finance-account-mapping.service';
import { FinanceBridgeListener } from '../../src/finance/finance-bridge.listener';
import { FinanceDlqService } from '../../src/finance/finance-dlq.service';
import { TenantContext } from '../../src/core/tenant/tenant-context';

// Same fail-closed disposable-database gate as the existing integration suites.
// Execute this suite only in the existing GitHub CI PostgreSQL 15 service.
function assertTestDatabase() {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Integration tests require an explicit test DATABASE_URL');
  }
  if (
    process.env.ONEERP_INTEGRATION_TEST !== '1' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)
  ) {
    throw new Error(
      'Integration tests require ONEERP_INTEGRATION_TEST=1 and a local database ending in _test',
    );
  }
}
assertTestDatabase();

describe('PostgreSQL stock-depletion accounting', () => {
  const prisma = new PrismaService();
  const eventName = 'inventory.stock_depleted';
  let module: TestingModule;
  let accounting: AccountingService;
  let queue: EventQueueService;
  let mappings: FinanceAccountMappingService;
  let companyId: string;
  let otherCompanyId: string;
  let materialId: string;
  let otherMaterialId: string;
  let locationId: string;
  let otherLocationId: string;
  let failJournalAfterInsert = false;
  let failQueueResolution = false;

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const args = params.args as { data?: { status?: string } } | undefined;
      if (
        failQueueResolution &&
        params.model === 'EventDlq' &&
        params.action === 'update' &&
        args?.data?.status === 'RESOLVED'
      ) {
        failQueueResolution = false;
        throw new Error('synthetic queue resolution failure');
      }
      const result: unknown = await next(params);
      if (
        failJournalAfterInsert &&
        params.model === 'JournalEntry' &&
        params.action === 'create'
      ) {
        failJournalAfterInsert = false;
        throw new Error('synthetic failure after journal and lines insert');
      }
      return result;
    });
    await prisma.$connect();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    await prisma.company.createMany({
      data: [companyId, otherCompanyId].map((id) => ({
        id,
        name: 'Synthetic stock accounting',
      })),
    });
    const locations = await Promise.all(
      [companyId, otherCompanyId].map((tenant) =>
        prisma.stockLocation.create({
          data: { companyId: tenant, name: 'Synthetic source' },
        }),
      ),
    );
    [locationId, otherLocationId] = locations.map((location) => location.id);
    const materials = await Promise.all(
      [companyId, otherCompanyId].map((tenant) =>
        prisma.material.create({
          data: {
            companyId: tenant,
            sku: randomUUID(),
            name: 'Synthetic material',
            category: 'test',
            unitPrice: 100,
          },
        }),
      ),
    );
    [materialId, otherMaterialId] = materials.map((material) => material.id);
    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AccountingService,
        AccountingPeriodService,
        FinanceAccountMappingService,
        FinanceBridgeListener,
        FinanceDlqService,
        EventQueueService,
      ],
    }).compile();
    await module.init();
    accounting = module.get(AccountingService);
    queue = module.get(EventQueueService);
    mappings = module.get(FinanceAccountMappingService);
    // Prewarm existing master data; concurrent delivery tests isolate posting.
    for (const tenant of [companyId, otherCompanyId]) {
      await mappings.ensureDefaultAccounts(tenant);
      await prisma.journal.create({
        data: {
          companyId: tenant,
          code: 'GEN',
          name: 'General Journal',
          type: 'GENERAL',
        },
      });
    }
  });

  afterEach(async () => {
    failJournalAfterInsert = false;
    failQueueResolution = false;
    jest.restoreAllMocks();
    const tenants = { in: [companyId, otherCompanyId] };
    // Only synthetic UUID-scoped records; never truncate a shared table.
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { companyId: tenants } },
    });
    await prisma.journalEntry.deleteMany({ where: { companyId: tenants } });
    await prisma.journal.deleteMany({ where: { companyId: tenants } });
    await prisma.financeAccountMapping.deleteMany({
      where: { companyId: tenants },
    });
    await prisma.account.deleteMany({ where: { companyId: tenants } });
    await prisma.accountingPeriod.deleteMany({ where: { companyId: tenants } });
    await prisma.eventDlq.deleteMany({ where: { companyId: tenants } });
    await prisma.inventoryTransaction.deleteMany({
      where: { companyId: tenants },
    });
    await prisma.materialCost.deleteMany({ where: { companyId: tenants } });
    await prisma.material.deleteMany({
      where: { id: { in: [materialId, otherMaterialId] } },
    });
    await prisma.stockLocation.deleteMany({ where: { companyId: tenants } });
    await prisma.company.deleteMany({ where: { id: tenants } });
    await module.close();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function movement(
    options: {
      company?: string;
      quantity?: number;
      cost?: number | null;
      referenceNo?: string | null;
      material?: string;
      location?: string;
      type?: string;
    } = {},
  ) {
    const tenant = options.company ?? companyId;
    const quantity = options.quantity ?? 2;
    const referenceNo =
      options.referenceNo === undefined
        ? 'SALE-SHIP-shared-order'
        : options.referenceNo;
    const transaction = await prisma.inventoryTransaction.create({
      data: {
        companyId: tenant,
        type: options.type ?? 'OUTBOUND',
        quantity,
        referenceNo,
        operatorId: 'SYSTEM',
        materialId:
          options.material ??
          (tenant === companyId ? materialId : otherMaterialId),
        sourceLocationId:
          options.location ??
          (tenant === companyId ? locationId : otherLocationId),
      },
    });
    const payload = {
      companyId: tenant,
      transactionId: transaction.id,
      idempotencyKey: `stock_depleted:${transaction.id}`,
      materialId: transaction.materialId,
      quantity,
      ...(referenceNo === null ? {} : { referenceNo }),
      ...(options.cost === null ? {} : { unitCost: options.cost ?? 8 }),
      operatorId: 'SYSTEM',
    };
    const event = await queue.enqueue({
      eventName,
      companyId: tenant,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (!event) throw new Error('Synthetic event unexpectedly deduplicated');
    return { transaction, payload, event };
  }
  function entries(tenant = companyId) {
    return prisma.journalEntry.findMany({
      where: { companyId: tenant },
      include: { lines: { include: { account: true } } },
    });
  }

  it('posts distinct allocations and partial movements sharing a reference exactly once each', async () => {
    const first = await movement({ quantity: 2, cost: 8 });
    const second = await movement({ quantity: 3, cost: 9 });
    expect((await queue.dispatchById(first.event.id)).status).toBe('RESOLVED');
    expect((await queue.dispatchById(second.event.id)).status).toBe('RESOLVED');
    await accounting.postStockDepletedEntry(first.payload);
    await accounting.postStockDepletedEntry(second.payload);
    const posted = await entries();
    expect(posted).toHaveLength(2);
    expect(
      new Set(posted.map((entry) => entry.inventoryTransactionId)),
    ).toEqual(new Set([first.transaction.id, second.transaction.id]));
    for (const entry of posted) {
      expect(entry.ref).toBe('SALE-SHIP-shared-order');
      expect(entry.postingStatus).toBe('POSTED');
      expect(entry.entryNo).toMatch(/^JE-/);
      expect(entry.lines).toHaveLength(2);
    }
    expect(
      posted
        .flatMap((entry) => entry.lines)
        .reduce((sum, line) => sum + Number(line.debit), 0),
    ).toBe(43);
    expect(
      posted
        .flatMap((entry) => entry.lines)
        .reduce((sum, line) => sum + Number(line.credit), 0),
    ).toBe(43);
  });

  it('deduplicates actual concurrent delivery, duplicate queue rows and replay under the database lock', async () => {
    const item = await movement();
    const duplicate = await queue.enqueue({
      eventName,
      companyId,
      idempotencyKey: item.payload.idempotencyKey,
      payload: item.payload,
    });
    expect(duplicate).not.toBeNull();
    if (!duplicate) throw new Error('Expected a synthetic duplicate event');
    const results = await Promise.all([
      queue.dispatchById(item.event.id),
      queue.dispatchById(duplicate.id),
      accounting.postStockDepletedEntry(item.payload),
      accounting.postStockDepletedEntry(item.payload),
    ]);
    expect(results.slice(0, 2)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'RESOLVED' })]),
    );
    expect(await entries()).toHaveLength(1);
    const replay = await accounting.postStockDepletedEntry(item.payload);
    expect(replay?.id).toBe((await entries())[0].id);
    expect(
      await prisma.journalEntryLine.count({
        where: { journalEntry: { companyId } },
      }),
    ).toBe(2);
    const events = await prisma.eventDlq.findMany({ where: { companyId } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.status === 'RESOLVED')).toBe(true);
  });

  it('rolls back the journal, lines and receipt after an inserted journal fails, retaining the original retry', async () => {
    const item = await movement();
    failJournalAfterInsert = true;
    const failure = await queue.dispatchById(item.event.id);
    expect(failure).toMatchObject({
      status: 'PENDING',
      error: 'synthetic failure after journal and lines insert',
    });
    expect(await entries()).toHaveLength(0);
    expect(
      await prisma.journalEntryLine.count({
        where: { journalEntry: { companyId } },
      }),
    ).toBe(0);
    expect(await prisma.eventDlq.count({ where: { companyId } })).toBe(1);
    expect(
      await prisma.eventDlq.findUniqueOrThrow({ where: { id: item.event.id } }),
    ).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect((await queue.dispatchById(item.event.id)).status).toBe('RESOLVED');
    expect(await entries()).toHaveLength(1);
    expect(
      await prisma.eventDlq.findUniqueOrThrow({ where: { id: item.event.id } }),
    ).toMatchObject({ status: 'RESOLVED', attempts: 2 });
  });

  it('posts and deduplicates concurrent deliveries with a one-connection pool without self-starvation', async () => {
    const first = await movement();
    const second = await movement();
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '2');
    const single = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    const scoped = single as unknown as PrismaService;
    const singleAccounting = new AccountingService(
      scoped,
      new FinanceAccountMappingService(scoped),
      new AccountingPeriodService(scoped),
    );
    try {
      const [one, replay, two] = await Promise.all([
        singleAccounting.postStockDepletedEntry(first.payload),
        singleAccounting.postStockDepletedEntry(first.payload),
        singleAccounting.postStockDepletedEntry(second.payload),
      ]);
      expect(one?.id).toBe(replay?.id);
      expect(two?.id).not.toBe(one?.id);
      expect(await entries()).toHaveLength(2);
    } finally {
      await single.$disconnect();
    }
  });

  it('accepts an authorized system-preset material under the real tenant context', async () => {
    const item = await movement();
    await prisma.material.update({
      where: { id: materialId },
      data: { companyId: null },
    });
    const posted = await TenantContext.run({ companyId }, () =>
      accounting.postStockDepletedEntry(item.payload),
    );
    expect(posted?.inventoryTransactionId).toBe(item.transaction.id);
    expect(await entries()).toHaveLength(1);
  });

  it('reuses a committed receipt if queue resolution fails after posting', async () => {
    const item = await movement();
    failQueueResolution = true;
    expect((await queue.dispatchById(item.event.id)).status).toBe('PENDING');
    const committed = (await entries())[0];
    expect(committed.inventoryTransactionId).toBe(item.transaction.id);
    expect((await queue.dispatchById(item.event.id)).status).toBe('RESOLVED');
    expect((await entries()).map((entry) => entry.id)).toEqual([committed.id]);
  });

  it('uses durable cost instead of changed master cost and rejects fabricated incoming values', async () => {
    const item = await movement({ cost: 8 });
    await prisma.materialCost.create({
      data: { companyId, materialId, averageCost: 99 },
    });
    await expect(
      accounting.postStockDepletedEntry({ ...item.payload, unitCost: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      accounting.postStockDepletedEntry({ ...item.payload, quantity: 999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      accounting.postStockDepletedEntry({
        ...item.payload,
        idempotencyKey: 'stock_depleted:wrong',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await entries()).toHaveLength(0);
    expect(
      (await accounting.postStockDepletedEntry(item.payload))?.totals,
    ).toEqual({ debit: 16, credit: 16 });
  });

  it('rejects conflicting durable snapshots instead of selecting whichever row happens to be first', async () => {
    const item = await movement();
    await queue.enqueue({
      eventName,
      companyId,
      idempotencyKey: item.payload.idempotencyKey,
      payload: { ...item.payload, unitCost: 9 },
    });
    expect((await queue.dispatchById(item.event.id)).status).toBe('PENDING');
    expect(await entries()).toHaveLength(0);
    expect(await prisma.eventDlq.count({ where: { companyId } })).toBe(2);
  });

  it('retains the vetted fallback for legacy durable events without a cost snapshot', async () => {
    const item = await movement({ cost: null });
    await prisma.materialCost.create({
      data: { companyId, materialId, averageCost: 12.5 },
    });
    expect(
      (await accounting.postStockDepletedEntry(item.payload))?.totals,
    ).toEqual({ debit: 25, credit: 25 });
  });

  it('preserves tenant isolation for movements, persisted snapshots and shared human references', async () => {
    const own = await movement();
    const other = await movement({ company: otherCompanyId });
    await expect(
      accounting.postStockDepletedEntry({
        ...own.payload,
        companyId: otherCompanyId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await prisma.eventDlq.update({
      where: { id: own.event.id },
      data: { companyId: otherCompanyId },
    });
    await expect(
      accounting.postStockDepletedEntry(own.payload),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await entries()).toHaveLength(0);
    await prisma.eventDlq.update({
      where: { id: own.event.id },
      data: { companyId },
    });
    await accounting.postStockDepletedEntry(own.payload);
    await accounting.postStockDepletedEntry(other.payload);
    expect(await entries()).toHaveLength(1);
    expect(await entries(otherCompanyId)).toHaveLength(1);
  });

  it.each(['material', 'location', 'type'] as const)(
    'rejects inconsistent legacy movement %s without creating a receipt',
    async (kind) => {
      const item = await movement({
        ...(kind === 'material' ? { material: otherMaterialId } : {}),
        ...(kind === 'location' ? { location: otherLocationId } : {}),
        ...(kind === 'type' ? { type: 'INBOUND' } : {}),
      });
      await expect(
        accounting.postStockDepletedEntry(item.payload),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await entries()).toHaveLength(0);
    },
  );

  it.each(['SALE-SHIP-shared-order', null])(
    'fails closed for a legacy unlinked INV journal with reference %j',
    async (referenceNo) => {
      const item = await movement({ referenceNo });
      const journal = await prisma.journal.create({
        data: {
          companyId,
          code: 'INV',
          name: 'Inventory Journal',
          type: 'INVENTORY',
        },
      });
      const legacy = await prisma.journalEntry.create({
        data: {
          companyId,
          journalId: journal.id,
          entryNo: randomUUID(),
          ref: referenceNo,
          date: new Date(),
          postingStatus: 'POSTED',
        },
      });
      expect((await queue.dispatchById(item.event.id)).status).toBe('PENDING');
      const posted = await entries();
      expect(posted.map((entry) => entry.id)).toEqual([legacy.id]);
      expect(posted[0].inventoryTransactionId).toBeNull();
    },
  );

  it('preserves closed-period rejection for new postings and allows committed receipt replay', async () => {
    const first = await movement();
    await accounting.postStockDepletedEntry(first.payload);
    const second = await movement();
    await prisma.accountingPeriod.create({
      data: {
        companyId,
        periodKey: 'synthetic-closed',
        startDate: new Date('2000-01-01'),
        endDate: new Date('2100-01-01'),
        status: 'CLOSED',
      },
    });
    expect((await queue.dispatchById(second.event.id)).status).toBe('PENDING');
    expect(await entries()).toHaveLength(1);
    expect(
      (await accounting.postStockDepletedEntry(first.payload))
        ?.inventoryTransactionId,
    ).toBe(first.transaction.id);
    await prisma.accountingPeriod.updateMany({
      where: { companyId },
      data: { status: 'OPEN' },
    });
    expect((await queue.dispatchById(second.event.id)).status).toBe('RESOLVED');
    expect(await entries()).toHaveLength(2);
  });

  it('retains configured accounts and refuses an account deactivated after mapping resolution', async () => {
    const item = await movement();
    const account = await prisma.account.create({
      data: {
        companyId,
        code: '6401-CUSTOM',
        name: 'Synthetic COGS',
        type: 'EXPENSE',
        isActive: true,
      },
    });
    await prisma.financeAccountMapping.create({
      data: {
        companyId,
        key: 'COGS',
        label: 'Synthetic COGS',
        accountId: account.id,
      },
    });
    const resolve = mappings.resolveLineAccount.bind(mappings);
    const deactivate = jest
      .spyOn(mappings, 'resolveLineAccount')
      .mockImplementation(async (tenant, key, fallback, client) => {
        const result = await resolve(tenant, key, fallback, client);
        if (key === 'COGS') {
          await prisma.account.update({
            where: { id: account.id },
            data: { isActive: false },
          });
        }
        return result;
      });
    expect((await queue.dispatchById(item.event.id)).status).toBe('PENDING');
    expect(await entries()).toHaveLength(0);
    deactivate.mockRestore();
    await prisma.account.update({
      where: { id: account.id },
      data: { isActive: true },
    });
    expect((await queue.dispatchById(item.event.id)).status).toBe('RESOLVED');
    expect(
      (await entries())[0].lines.find((line) => Number(line.debit) > 0)
        ?.accountId,
    ).toBe(account.id);
  });

  it('enforces the durable unique receipt and restricts deleting its source movement', async () => {
    const item = await movement();
    const posted = await accounting.postStockDepletedEntry(item.payload);
    if (!posted) throw new Error('Expected a synthetic journal');
    await expect(
      prisma.journalEntry.create({
        data: {
          companyId,
          journalId: posted.journalId,
          entryNo: randomUUID(),
          date: new Date(),
          inventoryTransactionId: item.transaction.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.inventoryTransaction.delete({
        where: { id: item.transaction.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await entries()).toHaveLength(1);
    expect(
      await prisma.inventoryTransaction.count({ where: { companyId } }),
    ).toBe(1);
  });
});
