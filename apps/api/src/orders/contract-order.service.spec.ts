import { BadRequestException, ConflictException } from '@nestjs/common';
import { ContractOrderService } from './contract-order.service';

describe('ContractOrderService', () => {
  const tx = {
    salesContract: { findFirst: jest.fn() },
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    documentSequence: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
    ),
  };
  const eventQueue = { publish: jest.fn() };
  let service: ContractOrderService;

  const activeContract = {
    id: 'contract-1',
    contractNo: 'CT-2026-000001',
    status: 'ACTIVE',
    partnerId: 'partner-1',
    ownerId: 'owner-1',
    currentVersionNo: 1,
    versions: [{ id: 'contract-version-1', versionNo: 1, status: 'ACTIVE' }],
    quoteVersion: {
      id: 'quote-version-2',
      items: [
        {
          id: 'quote-item-1',
          productId: 'product-1',
          skuSnapshot: 'P-001',
          nameSnapshot: '设备零件',
          uomSnapshot: 'pcs',
          quantity: 10,
          unitPrice: 100,
          discountRate: 0,
          taxRate: 0.13,
        },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-12T09:00:00+08:00'));
    service = new ContractOrderService(prisma as never, eventQueue as never);
    tx.salesContract.findFirst.mockResolvedValue(activeContract);
    tx.order.findFirst.mockResolvedValue(null);
    tx.order.findMany.mockResolvedValue([]);
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 1 });
    tx.order.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'order-1',
        ...data,
        partnerId: 'partner-1',
        items: (data.items as { create: unknown[] }).create,
        partner: { id: 'partner-1', name: '示例客户' },
      }),
    );
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    eventQueue.publish.mockResolvedValue({ id: 'event-1' });
  });

  afterEach(() => jest.useRealTimers());

  it('creates an order batch from contract snapshot prices', async () => {
    const result = await service.createBatch(
      'company-1',
      'operator-1',
      'contract-1',
      {
        sourceBatchKey: 'CT-2026-000001-BATCH-01',
        items: [{ quoteVersionItemId: 'quote-item-1', quantity: 4 }],
      },
    );

    expect(result).toMatchObject({
      idempotentReplay: false,
      order: {
        id: 'order-1',
        orderNo: 'ORD-2026-COMPAN-000001',
        salesContractId: 'contract-1',
        contractVersionId: 'contract-version-1',
      },
    });
    expect(String(result.order.totalAmount)).toBe('452');
    const [createArgs] = tx.order.create.mock.calls[0] as unknown as [
      { data: { items: { create: Array<Record<string, unknown>> } } },
    ];
    expect(createArgs.data.items.create[0]).toMatchObject({
      sourceQuoteVersionItemId: 'quote-item-1',
      quantity: 4,
      unitPrice: 100,
      taxRate: 0.13,
    });
    expect(String(createArgs.data.items.create[0].totalPrice)).toBe('452');
    expect(eventQueue.publish).toHaveBeenCalledTimes(1);
  });

  it('returns the original order for an identical sourceBatchKey replay', async () => {
    const first = await service.createBatch(
      'company-1',
      'operator-1',
      'contract-1',
      {
        sourceBatchKey: 'BATCH-01',
        items: [{ quoteVersionItemId: 'quote-item-1', quantity: 4 }],
      },
    );
    tx.order.findFirst.mockResolvedValue({
      ...first.order,
      sourceBatchHash: first.order.sourceBatchHash,
      salesContractId: 'contract-1',
    });

    const replay = await service.createBatch(
      'company-1',
      'operator-1',
      'contract-1',
      {
        sourceBatchKey: 'BATCH-01',
        items: [{ quoteVersionItemId: 'quote-item-1', quantity: 4 }],
      },
    );

    expect(replay).toMatchObject({ idempotentReplay: true });
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(eventQueue.publish).toHaveBeenCalledTimes(2);
  });

  it('rejects reusing a batch key with a different payload', async () => {
    tx.order.findFirst.mockResolvedValue({
      id: 'order-1',
      salesContractId: 'contract-1',
      sourceBatchHash: 'different-hash',
      items: [],
    });

    await expect(
      service.createBatch('company-1', 'operator-1', 'contract-1', {
        sourceBatchKey: 'BATCH-01',
        items: [{ quoteVersionItemId: 'quote-item-1', quantity: 4 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects quantities above the remaining contract allocation', async () => {
    tx.order.findMany.mockResolvedValue([
      {
        items: [{ sourceQuoteVersionItemId: 'quote-item-1', quantity: 8 }],
      },
    ]);

    await expect(
      service.createBatch('company-1', 'operator-1', 'contract-1', {
        sourceBatchKey: 'BATCH-02',
        items: [{ quoteVersionItemId: 'quote-item-1', quantity: 3 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports contracted, allocated, and remaining quantities', async () => {
    tx.order.findMany.mockResolvedValue([
      {
        items: [{ sourceQuoteVersionItemId: 'quote-item-1', quantity: 4 }],
      },
    ]);

    const preview = await service.getPreview('company-1', 'contract-1');

    expect(preview.items[0]).toMatchObject({
      contractedQuantity: '10',
      allocatedQuantity: '4',
      remainingQuantity: '6',
    });
  });
});
