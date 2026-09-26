import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventQueueService } from '../../src/core/events/event-queue.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { KyselyService } from '../../src/core/prisma/kysely.service';
import { StockQueryService } from '../../src/inventory/stock-query.service';
import { TenantContext } from '../../src/core/tenant/tenant-context';

// Same fail-closed disposable-PostgreSQL contract as the existing integration
// harness. No database URLs/credentials are printed and no shared data erased.
function requireTestDatabase() {
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
requireTestDatabase();

describe('PostgreSQL sales shipment quantity safety', () => {
  const prisma = new PrismaService();
  let companyId: string;
  let otherCompanyId: string;
  let userId: string;
  let partnerId: string;
  let locationId: string;
  let materialId: string;
  let productId: string;
  let orderId: string;
  let orderNo: string;
  let service: InventoryService;
  let queue: EventQueueService;
  let emitter: EventEmitter2;
  let readGate: (() => Promise<void>) | undefined;
  let reads = 0;
  let materialIds: string[];

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (
        readGate &&
        params.runInTransaction &&
        params.model === 'InventoryTransaction' &&
        params.action === 'findMany'
      ) {
        reads += 1;
        await readGate();
      }
      return result;
    });
    await prisma.$connect();
  });
  beforeEach(async () => {
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    userId = randomUUID();
    materialIds = [];
    await prisma.company.createMany({
      data: [companyId, otherCompanyId].map((id) => ({
        id,
        name: 'Synthetic shipment safety',
      })),
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Synthetic warehouse',
        email: `${userId}@example.invalid`,
        passwordHash: 'not-a-login-hash',
      },
    });
    partnerId = (
      await prisma.partner.create({
        data: { companyId, name: 'Synthetic buyer', type: 'CUSTOMER' },
      })
    ).id;
    locationId = (
      await prisma.stockLocation.create({
        data: { companyId, name: 'Synthetic location', code: randomUUID() },
      })
    ).id;
    emitter = new EventEmitter2();
    queue = new EventQueueService(prisma, emitter);
    service = new InventoryService(
      prisma,
      null as unknown as KyselyService,
      queue,
      null as unknown as StockQueryService,
    );
    const first = await product();
    materialId = first.materialId;
    productId = first.id;
    const order = await salesOrder([{ productId, quantity: 10 }]);
    orderId = order.id;
    orderNo = order.orderNo;
  });
  afterEach(async () => {
    readGate = undefined;
    jest.restoreAllMocks();
    if (!companyId) return;
    // Delete only synthetic IDs from this case, in FK order.
    await prisma.inventoryReturnLine.deleteMany({
      where: { returnDocument: { companyId } },
    });
    await prisma.inventoryReturnDocument.deleteMany({ where: { companyId } });
    await prisma.eventDlq.deleteMany({ where: { companyId } });
    await prisma.inventoryTransaction.deleteMany({ where: { companyId } });
    await prisma.inventoryLedgerSnapshot.deleteMany({ where: { companyId } });
    await prisma.materialCost.deleteMany({ where: { companyId } });
    await prisma.stockQuant.deleteMany({ where: { location: { companyId } } });
    await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
    await prisma.order.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
    await prisma.stockLocation.deleteMany({ where: { companyId } });
    await prisma.partner.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({
      where: { id: { in: [companyId, otherCompanyId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function product(
    sharedMaterialId?: string,
    owner: string | null = companyId,
  ) {
    const id =
      sharedMaterialId ??
      (
        await prisma.material.create({
          data: {
            companyId: owner,
            sku: randomUUID(),
            name: 'Synthetic material',
            category: 'TEST',
            unitPrice: 1,
          },
        })
      ).id;
    if (!sharedMaterialId) {
      materialIds.push(id);
      await service.createStockMove(
        companyId,
        {
          materialId: id,
          destLocationId: locationId,
          quantity: 50,
          batchNo: 'B1',
        },
        userId,
      );
    }
    const saved = await prisma.product.create({
      data: {
        companyId,
        materialId: id,
        sku: randomUUID(),
        name: 'Synthetic product',
        listPrice: 1,
      },
    });
    return { ...saved, materialId: id };
  }
  async function salesOrder(
    items: Array<{ productId: string; quantity: number }>,
    number: string = randomUUID(),
  ) {
    return prisma.order.create({
      data: {
        companyId,
        partnerId,
        salesId: userId,
        orderNo: number,
        status: 'DRAFT',
        items: {
          create: items.map((item) => ({
            ...item,
            unitPrice: 1,
            totalPrice: item.quantity,
          })),
        },
      },
    });
  }
  const ship = (
    quantity = 10,
    partial = false,
    id = orderId,
    product = productId,
  ) =>
    service.postSaleOrderShipment(
      companyId,
      id,
      {
        allowPartial: partial,
        items: [{ productId: product, shipQuantity: quantity }],
      },
      userId,
    );
  const reverse = (id = orderId) =>
    service.reverseSaleOrderShipment(companyId, id, {}, userId);
  const settleClock = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 5));
  async function state() {
    return {
      orders: await prisma.order.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
      }),
      stock: await prisma.stockQuant.findMany({
        where: { location: { companyId } },
        orderBy: { id: 'asc' },
      }),
      moves: await prisma.inventoryTransaction.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
      }),
      returns: await prisma.inventoryReturnDocument.findMany({
        where: { companyId },
        include: { lines: true },
        orderBy: { id: 'asc' },
      }),
      events: await prisma.eventDlq.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
      }),
      costs: await prisma.materialCost.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.inventoryLedgerSnapshot.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
      }),
    };
  }
  async function assertNet(expected: number, id = orderId, number = orderNo) {
    const outgoing = await prisma.inventoryTransaction.findMany({
      where: {
        companyId,
        type: 'OUTBOUND',
        referenceNo: `SALE-SHIP-${number}`,
      },
    });
    const documents = await prisma.inventoryReturnDocument.findMany({
      where: { companyId, sourceDocumentId: id, returnType: 'SALES' },
      include: { lines: true },
    });
    const net =
      outgoing.reduce((sum, move) => sum + Number(move.quantity), 0) -
      documents
        .flatMap((document) => document.lines)
        .reduce((sum, line) => sum + Number(line.quantity), 0);
    expect(net).toBeCloseTo(expected, 4);
    return outgoing;
  }
  function overlapReads() {
    reads = 0;
    let arrived = 0;
    let release: () => void = () => undefined;
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
                reject(new Error('Concurrent shipment read barrier timed out')),
              4000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  it.each([false, true])(
    'rejects duplicate products before any write (partial=%s)',
    async (allowPartial) => {
      const before = await state();
      await expect(
        service.postSaleOrderShipment(
          companyId,
          orderId,
          {
            allowPartial,
            items: [
              { productId, shipQuantity: 10 },
              { productId, shipQuantity: 10 },
            ],
          },
          userId,
        ),
      ).rejects.toThrow('重复');
      expect(await state()).toEqual(before);
    },
  );
  it('supports repeated order rows as one product demand', async () => {
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.orderItem.createMany({
      data: [6, 4].map((quantity) => ({
        orderId,
        productId,
        quantity,
        unitPrice: 1,
        totalPrice: quantity,
      })),
    });
    expect((await ship()).totalShipped).toBe(10);
    await assertNet(10);
  });
  it.each([
    [false, false],
    [false, true],
    [true, true],
  ])(
    'serializes concurrent same-demand requests (%s,%s)',
    async (left, right) => {
      overlapReads();
      const results = await Promise.allSettled([
        ship(10, left),
        ship(10, right),
      ]);
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );
      expect(reads).toBeGreaterThanOrEqual(3); // loser must retry its ledger read
      await assertNet(10);
      const snapshot = await state();
      expect(snapshot.orders[0].status).toBe('SHIPPED');
      expect(Number(snapshot.stock[0].quantity)).toBe(40);
      expect(snapshot.events).toHaveLength(1);
    },
  );
  it('serializes concurrent partial lines on different materials and retains SHIPPED', async () => {
    const second = await product();
    await prisma.orderItem.create({
      data: {
        orderId,
        productId: second.id,
        quantity: 10,
        unitPrice: 1,
        totalPrice: 10,
      },
    });
    overlapReads();
    const results = await Promise.all([
      ship(10, true),
      ship(10, true, orderId, second.id),
    ]);
    expect(results.every((result) => result.postedLines.length === 1)).toBe(
      true,
    );
    await assertNet(20);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe('SHIPPED');
  });
  it('preserves four-decimal delivered quantity when checking the cap', async () => {
    await ship(1.0001);
    const before = await state();
    await expect(ship(9)).rejects.toThrow('剩余可发');
    expect(await state()).toEqual(before);
    await ship(8.9999);
    await assertNet(10);
  });
  it('preserves partial success when another line has no stock', async () => {
    const second = await product();
    await prisma.orderItem.create({
      data: {
        orderId,
        productId: second.id,
        quantity: 10,
        unitPrice: 1,
        totalPrice: 10,
      },
    });
    await service.createStockMove(
      companyId,
      {
        sourceLocationId: locationId,
        materialId: second.materialId,
        quantity: 50,
        batchNo: 'B1',
      },
      userId,
    );
    const result = await service.postSaleOrderShipment(
      companyId,
      orderId,
      {
        allowPartial: true,
        items: [
          { productId, shipQuantity: 10 },
          { productId: second.id, shipQuantity: 10 },
        ],
      },
      userId,
    );
    expect(result.postedLines).toHaveLength(1);
    expect(result.skippedLines).toHaveLength(1);
    expect(result.status).toBe('PARTIAL_SHIPPED');
    await assertNet(10);
  });
  it.each([false, true])(
    'rolls back stock, state and outbox when enqueue fails (partial=%s)',
    async (allowPartial) => {
      const before = await state();
      const enqueue = queue.enqueueInTransaction.bind(queue);
      jest
        .spyOn(queue, 'enqueueInTransaction')
        .mockImplementation(async (tx, input) => {
          await enqueue(tx, input);
          throw new Error('synthetic enqueue failure');
        });
      if (allowPartial) {
        const result = await ship(10, true);
        expect(result.postedLines).toHaveLength(0);
        expect(result.skippedLines[0].reason).toContain(
          'synthetic enqueue failure',
        );
      } else await expect(ship()).rejects.toThrow('synthetic enqueue failure');
      expect(await state()).toEqual(before);
    },
  );
  it.each([false, true])(
    'does not replay committed shipment on dispatch error (partial=%s)',
    async (allowPartial) => {
      jest
        .spyOn(queue, 'dispatchById')
        .mockRejectedValueOnce(new Error('synthetic dispatch interruption'));
      await expect(ship(10, allowPartial)).rejects.toThrow(
        'synthetic dispatch interruption',
      );
      await assertNet(10);
      const snapshot = await state();
      expect(snapshot.orders[0].status).toBe('SHIPPED');
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0].status).toBe('PENDING');
      await expect(ship()).rejects.toThrow('已全部发货');
      await assertNet(10);
    },
  );
  it('allows complete shared-material groups atomically, then reversal and reshipment', async () => {
    const second = await product(materialId);
    await prisma.orderItem.create({
      data: {
        orderId,
        productId: second.id,
        quantity: 4,
        unitPrice: 1,
        totalPrice: 4,
      },
    });
    const payload = {
      items: [
        { productId, shipQuantity: 10 },
        { productId: second.id, shipQuantity: 4 },
      ],
    };
    const result = await service.postSaleOrderShipment(
      companyId,
      orderId,
      payload,
      userId,
    );
    expect(result.totalShipped).toBe(14);
    await assertNet(14);
    await settleClock();
    await reverse();
    await assertNet(0);
    await settleClock();
    await service.postSaleOrderShipment(companyId, orderId, payload, userId);
    await assertNet(14);
  });
  it('refuses ambiguous legacy shared-material partial history without changing it', async () => {
    await ship(2);
    const second = await product(materialId);
    await prisma.orderItem.create({
      data: {
        orderId,
        productId: second.id,
        quantity: 4,
        unitPrice: 1,
        totalPrice: 4,
      },
    });
    const before = await state();
    await expect(ship(8)).rejects.toThrow('共用物料');
    expect(await state()).toEqual(before);
  });
  it('skips a shared-material partial group but still commits an independent line', async () => {
    const shared = await product(materialId);
    const independent = await product();
    await prisma.orderItem.createMany({
      data: [shared, independent].map((item) => ({
        orderId,
        productId: item.id,
        quantity: 4,
        unitPrice: 1,
        totalPrice: 4,
      })),
    });
    const result = await service.postSaleOrderShipment(
      companyId,
      orderId,
      {
        allowPartial: true,
        items: [
          { productId, shipQuantity: 10 },
          { productId: shared.id, shipQuantity: 4 },
          { productId: independent.id, shipQuantity: 4 },
        ],
      },
      userId,
    );
    expect(result.postedLines.map((line) => line.productId)).toEqual([
      independent.id,
    ]);
    expect(result.skippedLines).toHaveLength(2);
    await assertNet(4);
  });
  it('rejects foreign tenant/order/material while preserving approved global material', async () => {
    const before = await state();
    await expect(
      service.postSaleOrderShipment(
        otherCompanyId,
        orderId,
        { items: [{ productId, shipQuantity: 10 }] },
        userId,
      ),
    ).rejects.toThrow('销售订单不存在');
    expect(await state()).toEqual(before);
    const foreign = await product(undefined, otherCompanyId);
    const foreignOrder = await salesOrder([
      { productId: foreign.id, quantity: 1 },
    ]);
    const foreignBefore = await state();
    await expect(ship(1, false, foreignOrder.id, foreign.id)).rejects.toThrow(
      '物料不存在或不属于',
    );
    expect(await state()).toEqual(foreignBefore);
    const global = await product(undefined, null);
    const globalOrder = await salesOrder([
      { productId: global.id, quantity: 1 },
    ]);
    const result = await TenantContext.run({ companyId }, () =>
      ship(1, false, globalOrder.id, global.id),
    );
    expect(result.status).toBe('SHIPPED');
  });
  it('does not subtract a neighboring order reversal and disambiguates colliding cycle references', async () => {
    await ship();
    await settleClock();
    await reverse();
    await settleClock();
    await ship();
    const neighbor = await salesOrder(
      [{ productId, quantity: 2 }],
      `${orderNo}-2`,
    );
    await ship(2, false, neighbor.id);
    await settleClock();
    await reverse(neighbor.id);
    await expect(ship(1)).rejects.toThrow('已全部发货');
    await assertNet(10);
    await settleClock();
    await reverse();
    const documents = await prisma.inventoryReturnDocument.findMany({
      where: { companyId },
    });
    expect(documents).toHaveLength(3);
    expect(
      new Set(documents.map((document) => document.referenceNo)).size,
    ).toBe(3);
    await assertNet(0);
    await settleClock();
    await ship();
    await assertNet(10);
  });
  it('fails closed on an unowned legacy reversal reference', async () => {
    await ship();
    await service.createStockMove(
      companyId,
      {
        materialId,
        destLocationId: locationId,
        quantity: 1,
        batchNo: 'B1',
        referenceNo: `SALE-SHIP-REV-${orderNo}`,
      },
      userId,
    );
    const before = await state();
    await expect(ship(1)).rejects.toThrow('退货单归属');
    expect(await state()).toEqual(before);
  });
  it('serializes shipment against reversal and leaves stock equal to net delivery', async () => {
    await ship(4);
    await settleClock();
    overlapReads();
    const results = await Promise.allSettled([ship(6), reverse()]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const snapshot = await state();
    const net = 50 - Number(snapshot.stock[0].quantity);
    expect([0, 6]).toContain(net);
    await assertNet(net);
    expect(snapshot.orders[0].status).toBe(
      net === 0 ? 'IN_PRODUCTION' : 'PARTIAL_SHIPPED',
    );
  });
  it('replays a concurrent reversal only once', async () => {
    await ship();
    await settleClock();
    overlapReads();
    const results = await Promise.all([reverse(), reverse()]);
    expect(
      new Set(results.map((result) => result.returnDocument?.id)).size,
    ).toBe(1);
    await assertNet(0);
    expect((await state()).returns).toHaveLength(1);
  });
  it('refuses same-millisecond reversal ambiguity without any mutation', async () => {
    await ship();
    await settleClock();
    const reversed = await reverse();
    await settleClock();
    await ship(2);
    const latest = await prisma.inventoryReturnDocument.findUniqueOrThrow({
      where: { id: reversed.returnDocument?.id },
    });
    const move = await prisma.inventoryTransaction.findFirstOrThrow({
      where: {
        companyId,
        type: 'OUTBOUND',
        referenceNo: `SALE-SHIP-${orderNo}`,
      },
      orderBy: { createdAt: 'desc' },
    });
    // Deliberately construct the exact timestamp(3) collision, not a normal-cycle workaround.
    await prisma.inventoryTransaction.update({
      where: { id: move.id },
      data: { createdAt: latest.postedAt },
    });
    const before = await state();
    await expect(reverse()).rejects.toThrow('同一毫秒');
    expect(await state()).toEqual(before);
  });

  it('rejects an already-returned move selected by an earlier transaction-start timestamp', async () => {
    await ship(4);
    await settleClock();
    const reversed = await reverse();
    const move = await prisma.inventoryTransaction.findFirstOrThrow({
      where: {
        companyId,
        type: 'OUTBOUND',
        referenceNo: `SALE-SHIP-${orderNo}`,
      },
    });
    // Reproduce a return transaction whose BEGIN time precedes the shipment it
    // saw in its first snapshot. CURRENT_TIMESTAMP uses BEGIN, not read/commit.
    await prisma.inventoryReturnDocument.update({
      where: { id: reversed.returnDocument?.id },
      data: { postedAt: new Date(move.createdAt.getTime() - 1) },
    });
    const before = await state();
    await expect(reverse()).rejects.toThrow('数量边界不一致');
    expect(await state()).toEqual(before);
    await assertNet(0);
  });

  it('does not claim replay when a bad cutoff hides still-outstanding movements', async () => {
    await ship(4);
    await settleClock();
    const reversed = await reverse();
    await settleClock();
    await ship(2);
    await prisma.inventoryReturnDocument.update({
      where: { id: reversed.returnDocument?.id },
      data: { postedAt: new Date(Date.now() + 1000) },
    });
    const before = await state();
    await expect(reverse()).rejects.toThrow('数量边界不一致');
    expect(await state()).toEqual(before);
    await assertNet(2);
  });

  it('allows reversal to correct historical over-shipment without applying current demand caps', async () => {
    await service.createStockMove(
      companyId,
      {
        materialId,
        sourceLocationId: locationId,
        quantity: 12,
        batchNo: 'B1',
        referenceNo: `SALE-SHIP-${orderNo}`,
      },
      userId,
    );
    await settleClock();
    await reverse();
    await assertNet(0);
    expect(Number((await state()).stock[0].quantity)).toBe(50);
  });

  it('retains the explicit internal rollbackStatus=false behavior', async () => {
    await ship();
    await settleClock();
    await service.reverseSaleOrderShipment(companyId, orderId, {}, userId, {
      rollbackStatus: false,
    });
    await assertNet(0);
    expect((await state()).orders[0].status).toBe('SHIPPED');
  });
});
