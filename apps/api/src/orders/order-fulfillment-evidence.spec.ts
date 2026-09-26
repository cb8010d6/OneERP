import {
  buildFulfillmentEvidence,
  FulfillmentLedgerRow,
  FulfillmentOrder,
} from './order-fulfillment-evidence';

describe('fulfillment evidence (material-level, never an allocation)', () => {
  const products = new Map([
    ['p1', { materialId: 'm1' }],
    ['p2', { materialId: 'm1' }],
  ]);
  const order: FulfillmentOrder = {
    id: 'o1',
    orderNo: 'ORD',
    items: [{ id: 'i1', productId: 'p1', quantity: 10 }],
    workOrders: [],
  };
  const row = (
    quantity: number,
    referenceNo = 'SALE-SHIP-ORD',
    type = 'OUTBOUND',
    id = 'move1',
  ): FulfillmentLedgerRow => ({
    id,
    companyId: 'c1',
    materialId: 'm1',
    quantity,
    referenceNo,
    type,
  });
  const evidence = (
    ledger: FulfillmentLedgerRow[] = [],
    stock = 0,
    demand = order,
    owners = new Map<string, string | null>(),
  ) =>
    buildFulfillmentEvidence(
      'c1',
      demand,
      products,
      new Map([['m1', stock]]),
      ledger,
      owners,
    );

  it('preserves four-place inventory precision', () => {
    const demand = {
      ...order,
      items: [{ ...order.items[0], quantity: 0.0003 }],
    };
    expect(
      evidence([row(0.0001)], 0.0001, demand).materialDemandGroups[0],
    ).toMatchObject({
      orderedQty: 0.0003,
      netShippedQty: 0.0001,
      remainingQty: 0.0002,
      onHandGapQty: 0.0001,
    });
  });

  it('distinguishes unknown unmapped supply from known zero mapped supply', () => {
    const unmappedOrder = {
      ...order,
      workOrders: [{ productId: 'p1', plannedQty: 5, actualQty: 0 }],
    };
    for (const mapping of [
      new Map<string, { materialId: string | null }>(),
      new Map([['p1', { materialId: null }]]),
    ]) {
      const result = buildFulfillmentEvidence(
        'c1',
        unmappedOrder,
        mapping,
        new Map(),
        [],
        new Map(),
      );
      expect(result).toMatchObject({
        assessment: 'DATA_REVIEW',
        materialDemandGroups: [
          {
            materialId: null,
            onHandQty: null,
            openWorkOrderQty: null,
            remainingQty: null,
          },
        ],
      });
      expect(result.issues).toContain('UNMATCHED_WORK_ORDER_PRODUCT');
      expect(result.issues).not.toContain('INVALID_STOCK_QUANTITY');
    }
    expect(evidence().materialDemandGroups[0]).toMatchObject({
      materialId: 'm1',
      onHandQty: 0,
      openWorkOrderQty: 0,
      assessment: 'SHORTAGE',
    });
  });

  it('rejects foreign-company material mappings but permits global materials', () => {
    expect(
      buildFulfillmentEvidence(
        'c1',
        order,
        new Map([['p1', { materialId: 'm1', materialCompanyId: 'other' }]]),
        new Map([['m1', 100]]),
        [],
        new Map(),
      ),
    ).toMatchObject({
      assessment: 'DATA_REVIEW',
      issues: ['FOREIGN_MATERIAL_MAPPING'],
    });
    expect(
      buildFulfillmentEvidence(
        'c1',
        order,
        new Map([['p1', { materialId: 'm1', materialCompanyId: null }]]),
        new Map([['m1', 100]]),
        [],
        new Map(),
      ).assessment,
    ).toBe('ON_HAND_COVERAGE');
  });

  it.each([
    [4, 3, 'SHORTAGE', 6, 3],
    [4, 6, 'ON_HAND_COVERAGE', 6, 0],
    [10, 0, 'FULFILLED', 0, 0],
  ])(
    'uses net shipments %s and stock %s',
    (shipped, stock, assessment, remainingQty, onHandGapQty) => {
      expect(evidence([row(shipped)], stock)).toMatchObject({
        assessment,
        materialDemandGroups: [
          { netShippedQty: shipped, remainingQty, onHandGapQty },
        ],
      });
    },
  );

  it('nets full reversals, partial reversals and multiple shipment cycles', () => {
    const ledger = [
      row(10),
      row(10, 'SALE-SHIP-REV-ORD', 'INBOUND', 'r1'),
      row(7),
      row(3, 'SALE-SHIP-REV-ORD-2', 'INBOUND', 'r2'),
    ];
    expect(
      evidence(
        ledger,
        0,
        order,
        new Map([
          ['r1', 'o1'],
          ['r2', 'o1'],
        ]),
      ).materialDemandGroups[0],
    ).toMatchObject({ netShippedQty: 4, remainingQty: 6 });
    expect(
      evidence(ledger.slice(0, 2), 0, order, new Map([['r1', 'o1']]))
        .materialDemandGroups[0].remainingQty,
    ).toBe(10);
  });

  it('groups duplicate product rows and shared-material products, counts stock/work balances once', () => {
    const demand = {
      ...order,
      items: [
        ...order.items,
        { id: 'i2', productId: 'p1', quantity: 5 },
        { id: 'i3', productId: 'p2', quantity: 5 },
      ],
      workOrders: [
        { productId: 'p1', plannedQty: 8, actualQty: 3 },
        { productId: 'p2', plannedQty: 3, actualQty: 5 },
      ],
    };
    expect(evidence([], 10, demand)).toMatchObject({
      assessment: 'SHORTAGE',
      materialDemandGroups: [
        {
          orderItemIds: ['i1', 'i2', 'i3'],
          productIds: ['p1', 'p2'],
          orderedQty: 20,
          onHandQty: 10,
          openWorkOrderQty: 5,
          onHandGapQty: 10,
          projectedGapQty: 5,
        },
      ],
    });
    expect(evidence([], 15, demand).assessment).toBe('WORK_ORDER_COVERAGE');
  });

  it('independent orders can reference the same unreserved stock', () => {
    expect(evidence([], 10).assessment).toBe('ON_HAND_COVERAGE');
    expect(evidence([], 10, { ...order, id: 'o2' }).assessment).toBe(
      'ON_HAND_COVERAGE',
    );
    expect(evidence([], 10).stockBasis).toBe('UNRESERVED_SNAPSHOT');
  });

  it('excludes other tenants and similarly prefixed outbound/nonnumeric reversal refs', () => {
    expect(
      evidence([
        { ...row(8), companyId: 'other' },
        row(8, 'SALE-SHIP-ORD-1'),
        row(8, 'SALE-SHIP-REV-ORD-other', 'INBOUND'),
      ]).materialDemandGroups[0].netShippedQty,
    ).toBe(0);
  });

  it('uses document move ownership to disambiguate ORD vs ORD-2', () => {
    const reversal = row(5, 'SALE-SHIP-REV-ORD-2', 'INBOUND', 'r2');
    expect(
      evidence([row(10), reversal], 0, order, new Map([['r2', 'other-order']]))
        .assessment,
    ).toBe('FULFILLED');
    expect(evidence([row(10), reversal])).toMatchObject({
      assessment: 'DATA_REVIEW',
      issues: ['AMBIGUOUS_REVERSAL_OWNERSHIP'],
      materialDemandGroups: [{ remainingQty: null }],
    });
    expect(
      evidence(
        [row(10), { ...reversal, referenceNo: 'SALE-SHIP-REV-ORD-o1-2' }],
        0,
        order,
        new Map([['r2', 'o1']]),
      ).materialDemandGroups[0].netShippedQty,
    ).toBe(5);
  });

  it.each([-1, 11, NaN, Infinity])(
    'marks invalid shipment %s unknown',
    (quantity) => {
      expect(evidence([row(quantity)], 100)).toMatchObject({
        assessment: 'DATA_REVIEW',
        materialDemandGroups: [
          {
            netShippedQty: null,
            remainingQty: null,
            onHandGapQty: null,
            projectedGapQty: null,
          },
        ],
      });
    },
  );

  it('marks a negative net unknown', () => {
    expect(
      evidence(
        [row(3, 'SALE-SHIP-REV-ORD', 'INBOUND')],
        100,
        order,
        new Map([['move1', 'o1']]),
      ).assessment,
    ).toBe('DATA_REVIEW');
  });

  it('marks empty, missing/inactive and unmapped products for review without hiding known groups', () => {
    expect(evidence([], 10, { ...order, items: [] }).assessment).toBe(
      'DATA_REVIEW',
    );
    const result = evidence([], 10, {
      ...order,
      items: [...order.items, { id: 'i2', productId: 'inactive', quantity: 2 }],
    });
    expect(result.assessment).toBe('DATA_REVIEW');
    expect(
      result.materialDemandGroups.map((group) => group.assessment),
    ).toEqual(['ON_HAND_COVERAGE', 'DATA_REVIEW']);
    expect(
      buildFulfillmentEvidence(
        'c1',
        order,
        new Map([['p1', { materialId: null }]]),
        new Map(),
        [],
        new Map(),
      ).issues,
    ).toContain('UNMAPPED_PRODUCT');
  });

  it('does not interpret unmatched historical material as zero shipments', () => {
    expect(
      evidence([{ ...row(3), materialId: 'old-material' }], 10),
    ).toMatchObject({
      assessment: 'DATA_REVIEW',
      issues: ['UNMATCHED_SHIPMENT_MATERIAL'],
      materialDemandGroups: [{ remainingQty: null }],
    });
  });

  it.each([-1, NaN, Infinity])(
    'fails closed for invalid stock or demand %s',
    (quantity) => {
      expect(evidence([], quantity).assessment).toBe('DATA_REVIEW');
      expect(
        evidence([], 100, {
          ...order,
          items: [{ ...order.items[0], quantity }],
        }).assessment,
      ).toBe('DATA_REVIEW');
    },
  );
});
