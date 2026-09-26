import {
  aggregateShipmentQuantitiesByProduct,
  parseFulfillmentEvidence,
} from '../order-fulfillment-evidence';

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    assessment: 'ON_HAND_COVERAGE',
    issues: [],
    materialDemandGroups: [
      {
        materialId: 'material-1',
        materialName: 'Widget',
        materialSku: 'W-1',
        materialUnit: 'pcs',
        orderItemIds: ['item-1'],
        productIds: ['product-1'],
        orderedQty: 10,
        netShippedQty: 6,
        remainingQty: 4,
        onHandQty: 2,
        openWorkOrderQty: 2,
        onHandGapQty: 2,
        projectedGapQty: 0,
        assessment: 'WORK_ORDER_COVERAGE',
        issues: [],
      },
    ],
    stockBasis: 'UNRESERVED_SNAPSHOT',
    workOrderBasis: 'UNFINISHED_NOT_ETA',
    ...overrides,
  };
}

describe('parseFulfillmentEvidence', () => {
  it('rejects missing, legacy-only, and unrecognized assessment payloads', () => {
    expect(parseFulfillmentEvidence(undefined)).toBeNull();
    expect(
      parseFulfillmentEvidence({
        overallStatus: 'READY',
        lines: [{ status: 'READY', projectedQty: 0 }],
      }),
    ).toBeNull();
    expect(
      parseFulfillmentEvidence(evidence({ assessment: 'READY' })),
    ).toBeNull();
  });

  it('accepts nullable evidence quantities without converting unknowns to zero', () => {
    const parsed = parseFulfillmentEvidence(
      evidence({
        materialDemandGroups: [
          {
            ...evidence().materialDemandGroups[0],
            orderedQty: null,
            netShippedQty: null,
            remainingQty: null,
            onHandQty: null,
            openWorkOrderQty: null,
            onHandGapQty: null,
            projectedGapQty: null,
          },
        ],
      }),
    );

    expect(parsed?.materialDemandGroups[0]).toMatchObject({
      orderedQty: null,
      netShippedQty: null,
      remainingQty: null,
      onHandQty: null,
      openWorkOrderQty: null,
      onHandGapQty: null,
      projectedGapQty: null,
    });
  });
});

describe('aggregateShipmentQuantitiesByProduct', () => {
  it('sends only explicitly selected duplicate rows and omits zero rows', () => {
    expect(
      aggregateShipmentQuantitiesByProduct([
        { productId: 'product-1', shipQuantity: 2 },
        { productId: 'product-1', shipQuantity: 0 },
      ]),
    ).toEqual([{ productId: 'product-1', shipQuantity: 2 }]);
  });

  it('aggregates duplicate product rows once at four decimal places', () => {
    expect(
      aggregateShipmentQuantitiesByProduct([
        { productId: 'product-1', shipQuantity: 0.0001 },
        { productId: 'product-1', shipQuantity: 8.9999 },
      ]),
    ).toEqual([{ productId: 'product-1', shipQuantity: 9 }]);
  });

  it('rounds once after summing to avoid per-row precision loss', () => {
    expect(
      aggregateShipmentQuantitiesByProduct([
        { productId: 'product-1', shipQuantity: 0.0004 },
        { productId: 'product-1', shipQuantity: 0.0004 },
        { productId: 'product-1', shipQuantity: 0.0004 },
      ]),
    ).toEqual([{ productId: 'product-1', shipQuantity: 0.0012 }]);
  });
});
