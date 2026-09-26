import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventQueueService } from '../../src/core/events/event-queue.service';
import { AccountingService } from '../../src/finance/accounting.service';
import { FinanceAccountMappingService } from '../../src/finance/finance-account-mapping.service';
import { PurchaseService } from '../../src/purchase/purchase.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { SupplierStatementService } from '../../src/purchase/supplier-statement.service';
import { PurchaseQueryService } from '../../src/purchase/purchase-query.service';

// Fail closed before constructing a client. Only an explicitly opted-in local,
// disposable PostgreSQL test database is permitted; never truncate shared data.
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

type Kind = 'payment' | 'credit';
const kinds: Kind[] = ['payment', 'credit'];

describe.each(kinds)('PostgreSQL supplier %s posting', (kind) => {
  const prisma = new PrismaService();
  let companyId: string;
  let otherCompanyId: string;
  let supplierId: string;
  let buyerId: string;
  let invoiceId: string;
  let queue: EventQueueService;
  let emitter: EventEmitter2;
  let service: PurchaseService;
  let readGate: (() => Promise<void>) | undefined;
  let postingReads = 0;
  const eventName = `purchase.supplier_${kind === 'payment' ? 'payment' : 'credit_note'}.posted`;

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        readGate &&
        params.action === 'findFirst' &&
        params.model ===
          (kind === 'payment' ? 'SupplierPayment' : 'SupplierCreditNote')
      ) {
        postingReads += 1;
        await readGate();
      }
      return result;
    });
    await prisma.$connect();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    buyerId = randomUUID();
    await prisma.company.createMany({
      data: [companyId, otherCompanyId].map((id) => ({
        id,
        name: 'Synthetic posting regression',
      })),
    });
    await prisma.user.create({
      data: {
        id: buyerId,
        name: 'Synthetic buyer',
        email: `${buyerId}@example.invalid`,
        passwordHash: 'not-a-login-hash',
      },
    });
    const supplier = await prisma.partner.create({
      data: { companyId, name: 'Synthetic supplier', type: 'SUPPLIER' },
    });
    supplierId = supplier.id;
    const order = await prisma.purchaseOrder.create({
      data: { companyId, buyerId, supplierId, purchaseNo: randomUUID() },
    });
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId,
        purchaseOrderId: order.id,
        invoiceNo: randomUUID(),
        amount: '100.00',
        postingStatus: 'POSTED',
      },
    });
    invoiceId = invoice.id;
    emitter = new EventEmitter2();
    queue = new EventQueueService(prisma, emitter);
    service = new PurchaseService(
      prisma,
      null as unknown as InventoryService,
      queue,
      null as unknown as SupplierStatementService,
      null as unknown as PurchaseQueryService,
    );
  });

  afterEach(async () => {
    readGate = undefined;
    jest.restoreAllMocks();
    if (!companyId) return;
    // Every delete is restricted to UUIDs created by this test; FK order matters.
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { companyId } },
    });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.journal.deleteMany({ where: { companyId } });
    await prisma.financeAccountMapping.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.eventDlq.deleteMany({ where: { companyId } });
    await prisma.supplierPaymentAllocation.deleteMany({ where: { companyId } });
    await prisma.supplierPayment.deleteMany({ where: { companyId } });
    await prisma.supplierCreditNote.deleteMany({ where: { companyId } });
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.purchaseOrder.deleteMany({ where: { companyId } });
    await prisma.partner.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({
      where: { id: { in: [companyId, otherCompanyId] } },
    });
    await prisma.user.deleteMany({ where: { id: buyerId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function draft(amount = '60.00') {
    if (kind === 'payment') {
      return prisma.supplierPayment.create({
        data: {
          companyId,
          supplierId,
          paymentNo: randomUUID(),
          amount,
          method: 'BANK_TRANSFER',
          allocations: {
            create: { companyId, purchaseInvoiceId: invoiceId, amount },
          },
        },
      });
    }
    return prisma.supplierCreditNote.create({
      data: {
        companyId,
        supplierId,
        purchaseInvoiceId: invoiceId,
        creditNo: randomUUID(),
        amount,
      },
    });
  }
  function post(id: string, tenant = companyId) {
    return kind === 'payment'
      ? service.postSupplierPayment(tenant, id)
      : service.postSupplierCreditNote(tenant, id);
  }
  function persisted(id: string) {
    return kind === 'payment'
      ? prisma.supplierPayment.findUniqueOrThrow({ where: { id } })
      : prisma.supplierCreditNote.findUniqueOrThrow({ where: { id } });
  }
  function events() {
    return prisma.eventDlq.findMany({ where: { companyId, eventName } });
  }
  function overlapFirstReads() {
    postingReads = 0;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    readGate = async () => {
      arrived += 1;
      if (arrived === 2) release();
      // Bounded barrier turns a missing second read into a useful failure.
      if (arrived <= 2) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            gate,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Concurrent read barrier timed out')),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
    };
  }

  it('rolls back the document, invoice and inserted outbox when enqueue fails', async () => {
    const document = await draft();
    const enqueue = queue.enqueueInTransaction.bind(queue);
    jest
      .spyOn(queue, 'enqueueInTransaction')
      .mockImplementation(async (tx, input) => {
        await enqueue(tx, input);
        throw new Error('synthetic enqueue failure after insert');
      });
    await expect(post(document.id)).rejects.toThrow(
      'synthetic enqueue failure',
    );
    expect((await persisted(document.id)).postingStatus).toBe('DRAFT');
    expect((await persisted(document.id)).postedAt).toBeNull();
    expect(
      (
        await prisma.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoiceId },
        })
      ).status,
    ).toBe('UNPAID');
    expect(await events()).toHaveLength(0);
  });

  it('keeps committed state and durable event on dispatch failure, then retries delivery', async () => {
    const document = await draft();
    const delivery = jest.fn(() => {
      throw new Error('synthetic listener failure');
    });
    emitter.on(eventName, delivery);
    await post(document.id);
    expect((await persisted(document.id)).postingStatus).toBe('POSTED');
    expect(
      (
        await prisma.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoiceId },
        })
      ).status,
    ).toBe('PARTIAL');
    const pending = await events();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(pending[0].payload).toMatchObject({ companyId });
    await post(document.id);
    expect(await events()).toHaveLength(1);
    emitter.removeAllListeners(eventName);
    await queue.dispatchById(pending[0].id);
    expect((await events())[0]).toMatchObject({
      status: 'RESOLVED',
      attempts: 2,
    });
    expect(delivery).toHaveBeenCalledTimes(1);
  });

  it('retains the committed outbox if dispatch itself rejects after commit', async () => {
    const document = await draft();
    const dispatch = jest
      .spyOn(queue, 'dispatchById')
      .mockRejectedValueOnce(new Error('synthetic dispatch interruption'));
    await expect(post(document.id)).rejects.toThrow(
      'synthetic dispatch interruption',
    );
    expect((await persisted(document.id)).postingStatus).toBe('POSTED');
    const pending = await events();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    dispatch.mockRestore();
    await post(document.id);
    expect(await events()).toHaveLength(1);
    await queue.dispatchById(pending[0].id);
    expect((await events())[0].status).toBe('RESOLVED');
  });

  it('serializes concurrent posts of the same draft and emits only one event', async () => {
    const document = await draft();
    overlapFirstReads();
    await Promise.all([post(document.id), post(document.id)]);
    expect(postingReads).toBeGreaterThanOrEqual(3);
    expect((await persisted(document.id)).postingStatus).toBe('POSTED');
    expect(await events()).toHaveLength(1);
    await post(document.id);
    expect(await events()).toHaveLength(1);
  });

  it('rechecks remaining amount after a real concurrent serialization conflict', async () => {
    const first = await draft('60.00');
    const second = await draft('60.00');
    overlapFirstReads();
    const results = await Promise.allSettled([post(first.id), post(second.id)]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(
      failed?.status === 'rejected' &&
        failed.reason instanceof BadRequestException,
    ).toBe(true);
    expect(postingReads).toBeGreaterThanOrEqual(3);
    const documents = await Promise.all([
      persisted(first.id),
      persisted(second.id),
    ]);
    expect(
      documents.filter((item) => item.postingStatus === 'POSTED'),
    ).toHaveLength(1);
    expect(
      documents.filter((item) => item.postingStatus === 'DRAFT'),
    ).toHaveLength(1);
    expect(
      (
        await prisma.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoiceId },
        })
      ).status,
    ).toBe('PARTIAL');
    expect(await events()).toHaveLength(1);
  });

  it('creates one balanced supplier journal under concurrent delivery and replay', async () => {
    const document = await draft();
    await post(document.id);
    const mappings = new FinanceAccountMappingService(prisma);
    await mappings.ensureDefaultAccounts(companyId);
    await prisma.journal.create({
      data: {
        companyId,
        code: 'GEN',
        name: 'General Journal',
        type: 'GENERAL',
      },
    });
    const accounting = new AccountingService(prisma, mappings);
    const deliver = () =>
      kind === 'payment'
        ? accounting.postSupplierPaymentEntry({
            companyId,
            supplierPaymentId: document.id,
          })
        : accounting.postSupplierCreditNotePostedEntry({
            companyId,
            supplierCreditNoteId: document.id,
          });
    overlapFirstReads();
    const [first, second] = await Promise.all([deliver(), deliver()]);
    expect(first.id).toBe(second.id);
    expect((await deliver()).id).toBe(first.id);
    const entries = await prisma.journalEntry.findMany({
      where: { companyId },
      include: { lines: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].postingStatus).toBe('POSTED');
    expect(entries[0].lines).toHaveLength(2);
    expect(
      entries[0].lines.reduce((total, line) => total + Number(line.debit), 0),
    ).toBe(60);
    expect(
      entries[0].lines.reduce((total, line) => total + Number(line.credit), 0),
    ).toBe(60);
  });

  it('continues allowing intentional manual journals with the same reference', async () => {
    const mappings = new FinanceAccountMappingService(prisma);
    const accounting = new AccountingService(prisma, mappings);
    const input = {
      companyId,
      journalCode: 'GEN',
      journalName: 'General Journal',
      journalType: 'GENERAL' as const,
      ref: 'synthetic-repeatable-manual-reference',
      lines: [
        {
          accountCode: '1002',
          accountName: '银行存款',
          accountType: 'ASSET',
          debit: 10,
        },
        {
          accountCode: '2202',
          accountName: '应付账款',
          accountType: 'LIABILITY',
          credit: 10,
        },
      ],
    };
    const first = await accounting.createBalancedEntry(input);
    const second = await accounting.createBalancedEntry(input);
    expect(first.id).not.toBe(second.id);
    expect(
      await prisma.journalEntry.count({ where: { companyId, ref: input.ref } }),
    ).toBe(2);
  });

  it('refuses another tenant without changing document, invoice or outbox', async () => {
    const document = await draft();
    await expect(post(document.id, otherCompanyId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await persisted(document.id)).postingStatus).toBe('DRAFT');
    expect(
      (
        await prisma.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoiceId },
        })
      ).status,
    ).toBe('UNPAID');
    expect(await events()).toHaveLength(0);
  });
});
