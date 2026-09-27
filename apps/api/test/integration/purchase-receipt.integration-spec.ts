import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventQueueService } from '../../src/core/events/event-queue.service';
import { PurchaseService } from '../../src/purchase/purchase.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { KyselyService } from '../../src/core/prisma/kysely.service';
import { StockQueryService } from '../../src/inventory/stock-query.service';
import { SupplierStatementService } from '../../src/purchase/supplier-statement.service';
import { PurchaseQueryService } from '../../src/purchase/purchase-query.service';
import { ReceivePurchaseOrderDto } from '../../src/purchase/dto/purchase.dto';

// Same fail-closed contract as the existing PostgreSQL suites. Fixtures and
// cleanup are restricted to synthetic UUID tenants in a disposable database.
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

describe('PostgreSQL purchase receipt quantity safety', () => {
  const prisma = new PrismaService();
  let companyId: string;
  let otherCompanyId: string;
  let buyerId: string;
  let materialId: string;
  let orderId: string;
  let lineId: string;
  let locationIds: string[];
  let foreignLocationId: string;
  let inventory: InventoryService;
  let service: PurchaseService;
  let readGate: (() => Promise<void>) | undefined;
  let receiptReads = 0;

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        readGate &&
        params.runInTransaction &&
        params.model === 'PurchaseOrder' &&
        params.action === 'findFirst'
      ) {
        receiptReads += 1;
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
        name: 'Synthetic receipt regression',
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
    materialId = (
      await prisma.material.create({
        data: {
          companyId,
          sku: randomUUID(),
          name: 'Synthetic receipt material',
          category: 'TEST',
          unitPrice: 2,
        },
      })
    ).id;
    locationIds = [];
    for (let index = 0; index < 2; index += 1) {
      locationIds.push(
        (
          await prisma.stockLocation.create({
            data: {
              companyId,
              name: `Synthetic location ${index}`,
              code: randomUUID(),
            },
          })
        ).id,
      );
    }
    foreignLocationId = (
      await prisma.stockLocation.create({
        data: {
          companyId: otherCompanyId,
          name: 'Synthetic other-tenant location',
          code: randomUUID(),
        },
      })
    ).id;
    const order = await prisma.purchaseOrder.create({
      data: {
        companyId,
        buyerId,
        supplierId: supplier.id,
        purchaseNo: randomUUID(),
        status: 'ORDERED',
        items: { create: { materialId, quantity: 10, unitPrice: 2 } },
      },
      include: { items: true },
    });
    orderId = order.id;
    lineId = order.items[0].id;
    const queue = new EventQueueService(prisma, new EventEmitter2());
    inventory = new InventoryService(
      prisma,
      null as unknown as KyselyService,
      queue,
      null as unknown as StockQueryService,
    );
    service = new PurchaseService(
      prisma,
      inventory,
      queue,
      null as unknown as SupplierStatementService,
      null as unknown as PurchaseQueryService,
    );
  });

  afterEach(async () => {
    readGate = undefined;
    jest.restoreAllMocks();
    if (!companyId) return;
    await prisma.purchaseReceiptLine.deleteMany({
      where: { receipt: { companyId } },
    });
    await prisma.purchaseReceipt.deleteMany({ where: { companyId } });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { companyId } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { companyId } });
    await prisma.eventDlq.deleteMany({ where: { companyId } });
    await prisma.inventoryTransaction.deleteMany({ where: { companyId } });
    await prisma.inventoryLedgerSnapshot.deleteMany({ where: { companyId } });
    await prisma.materialCost.deleteMany({ where: { companyId } });
    await prisma.stockQuant.deleteMany({ where: { location: { companyId } } });
    await prisma.material.deleteMany({ where: { companyId } });
    await prisma.stockLocation.deleteMany({
      where: { companyId: { in: [companyId, otherCompanyId] } },
    });
    await prisma.partner.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({
      where: { id: { in: [companyId, otherCompanyId] } },
    });
    await prisma.user.deleteMany({ where: { id: buyerId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function dto(quantities: number[]): ReceivePurchaseOrderDto {
    return {
      lines: quantities.map((quantity, index) => ({
        purchaseOrderLineId: lineId,
        quantity,
        destLocationId: locationIds[index % 2],
        batchNo: `B${index}`,
      })),
    };
  }
  function receive(quantities: number[]) {
    return service.receivePurchaseOrder(
      companyId,
      buyerId,
      orderId,
      dto(quantities),
    );
  }
  async function state() {
    const [line, order, receipts, movements, stock, costs, ledger, events] =
      await Promise.all([
        prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } }),
        prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }),
        prisma.purchaseReceipt.findMany({
          where: { companyId },
          include: { lines: true },
        }),
        prisma.inventoryTransaction.findMany({ where: { companyId } }),
        prisma.stockQuant.findMany({ where: { location: { companyId } } }),
        prisma.materialCost.findMany({ where: { companyId } }),
        prisma.inventoryLedgerSnapshot.findMany({ where: { companyId } }),
        prisma.eventDlq.findMany({ where: { companyId } }),
      ]);
    return { line, order, receipts, movements, stock, costs, ledger, events };
  }
  async function expectUnchanged() {
    const saved = await state();
    expect(saved.line.receivedQty.toString()).toBe('0');
    expect(saved.order.status).toBe('ORDERED');
    for (const rows of [
      saved.receipts,
      saved.movements,
      saved.stock,
      saved.costs,
      saved.ledger,
      saved.events,
    ])
      expect(rows).toHaveLength(0);
  }
  function overlapFirstReads() {
    receiptReads = 0;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    readGate = async () => {
      arrived += 1;
      if (arrived === 2) release();
      if (arrived > 2) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          gate,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error('Concurrent receipt read barrier timed out')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  it('rejects duplicate 6+6 against an ordered quantity of 10 without writes', async () => {
    await expect(receive([6, 6])).rejects.toBeInstanceOf(BadRequestException);
    await expectUnchanged();
  });

  it('preserves valid 2+3 location/batch splits and records received quantity 5', async () => {
    await receive([2, 3]);
    const saved = await state();
    expect(saved.line.receivedQty.toString()).toBe('5');
    expect(saved.order.status).toBe('PARTIAL_RECEIVED');
    expect(saved.receipts).toHaveLength(1);
    expect(saved.receipts[0].lines).toHaveLength(2);
    expect(saved.movements).toHaveLength(2);
    for (const [index, quantity] of [2, 3].entries()) {
      expect(
        saved.stock
          .find(
            (row) =>
              row.locationId === locationIds[index] &&
              row.batchNo === `B${index}`,
          )
          ?.quantity.toNumber(),
      ).toBe(quantity);
      expect(
        saved.receipts[0].lines
          .find((row) => row.destLocationId === locationIds[index])
          ?.quantity.toNumber(),
      ).toBe(quantity);
    }
    expect(saved.costs[0].quantityOnHand.toString()).toBe('5');
    expect(saved.costs[0].inventoryValue.toString()).toBe('10');
    expect(saved.events).toHaveLength(0); // Existing inbound receipts have no depletion event.
  });

  it('keeps four-decimal split receipt, stock and order quantities equal', async () => {
    await receive([0.0001, 0.0002]);
    const saved = await state();
    expect(saved.line.receivedQty.toString()).toBe('0.0003');
    expect(saved.costs[0].quantityOnHand.toString()).toBe('0.0003');
    expect(
      saved.receipts[0].lines
        .reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0))
        .toString(),
    ).toBe('0.0003');
    expect(
      saved.stock
        .reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0))
        .toString(),
    ).toBe('0.0003');
  });

  it('rejects precision that PostgreSQL would round differently for split rows', async () => {
    await expect(receive([0.00015, 0.00015])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expectUnchanged();
  });

  it('normalizes legacy client subtraction noise consistently across all receipt quantities', async () => {
    await prisma.purchaseOrderLine.update({
      where: { id: lineId },
      data: { quantity: '0.3' },
    });
    await receive([0.1]);
    await receive([0.3 - 0.1]);
    const saved = await state();
    expect(saved.line.receivedQty.toString()).toBe('0.3');
    expect(saved.order.status).toBe('RECEIVED');
    expect(saved.receipts).toHaveLength(2);
    expect(
      saved.receipts
        .flatMap((receipt) => receipt.lines)
        .map((line) => line.quantity.toString())
        .sort(),
    ).toEqual(['0.1', '0.2']);
    expect(saved.stock[0].quantity.toString()).toBe('0.3');
    expect(saved.costs[0].quantityOnHand.toString()).toBe('0.3');
    expect(
      saved.movements.map((move) => move.quantity.toString()).sort(),
    ).toEqual(['0.1', '0.2']);
  });

  it('allows only one concurrent receipt of 6 against an ordered quantity of 10', async () => {
    overlapFirstReads();
    const results = await Promise.allSettled([receive([6]), receive([6])]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(
      BadRequestException,
    );
    expect(receiptReads).toBeGreaterThanOrEqual(3); // Retry rereads the winner's committed quantity.
    const saved = await state();
    expect(saved.receipts).toHaveLength(1);
    expect(saved.movements).toHaveLength(1);
    expect(saved.line.receivedQty.toString()).toBe('6');
    expect(saved.stock[0].quantity.toString()).toBe('6');
    expect(saved.costs[0].quantityOnHand.toString()).toBe('6');
  });

  it('retains both valid concurrent partial receipts after conflict retry', async () => {
    overlapFirstReads();
    await Promise.all([receive([2]), receive([3])]);
    const saved = await state();
    expect(receiptReads).toBeGreaterThanOrEqual(3);
    expect(saved.receipts).toHaveLength(2);
    expect(saved.movements).toHaveLength(2);
    expect(saved.line.receivedQty.toString()).toBe('5');
    expect(saved.stock[0].quantity.toString()).toBe('5');
  });

  it('rolls back receipt, progress and every stock/cost write on a late stock failure, then accepts retry', async () => {
    const move = inventory.createStockMoveInTransaction.bind(inventory);
    let count = 0;
    const fault = jest
      .spyOn(inventory, 'createStockMoveInTransaction')
      .mockImplementation(async (...args) => {
        const result = await move(...args);
        count += 1;
        if (count === 2)
          throw new Error('synthetic failure after second stock write');
        return result;
      });
    await expect(receive([2, 3])).rejects.toThrow(
      'synthetic failure after second stock write',
    );
    await expectUnchanged();
    fault.mockRestore();
    await receive([2, 3]);
    const saved = await state();
    expect(saved.receipts).toHaveLength(1);
    expect(saved.movements).toHaveLength(2);
    expect(saved.line.receivedQty.toString()).toBe('5');
  });

  it('rejects another tenant order without writes', async () => {
    await expect(
      service.receivePurchaseOrder(otherCompanyId, buyerId, orderId, dto([2])),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expectUnchanged();
  });

  it('rolls back a split receipt when a destination belongs to another tenant', async () => {
    const request = dto([2, 3]);
    request.lines[1].destLocationId = foreignLocationId;
    await expect(
      service.receivePurchaseOrder(companyId, buyerId, orderId, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expectUnchanged();
  });

  it('rejects a line that is not on the requested purchase order', async () => {
    const request = dto([2]);
    request.lines[0].purchaseOrderLineId = randomUUID();
    await expect(
      service.receivePurchaseOrder(companyId, buyerId, orderId, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expectUnchanged();
  });

  it('keeps existing replay semantics: partial requests are new receipts, completed orders reject repeats', async () => {
    await receive([2]);
    await receive([2]);
    expect((await state()).line.receivedQty.toString()).toBe('4');
    expect((await state()).receipts).toHaveLength(2);
    await receive([6]);
    await expect(receive([6])).rejects.toBeInstanceOf(BadRequestException);
    const saved = await state();
    expect(saved.receipts).toHaveLength(3);
    expect(saved.line.receivedQty.toString()).toBe('10');
    expect(saved.order.status).toBe('RECEIVED');
    expect(saved.stock[0].quantity.toString()).toBe('10');
  });

  it('does not replay committed writes when the response read raises a retryable database error', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'synthetic response conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    jest.spyOn(service, 'getPurchaseOrder').mockRejectedValueOnce(error);
    await expect(receive([6])).rejects.toMatchObject({ code: 'P2034' });
    const saved = await state();
    expect(saved.receipts).toHaveLength(1);
    expect(saved.movements).toHaveLength(1);
    expect(saved.line.receivedQty.toString()).toBe('6');
    await expect(receive([6])).rejects.toBeInstanceOf(BadRequestException);
    expect((await state()).receipts).toHaveLength(1);
  });
});
