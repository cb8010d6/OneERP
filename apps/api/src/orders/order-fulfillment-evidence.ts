import { roundDecimal } from '../core/utils/decimal';

const roundQuantity = (value: number) => roundDecimal(value, 4);

export type FulfillmentAssessment =
  | 'FULFILLED'
  | 'ON_HAND_COVERAGE'
  | 'WORK_ORDER_COVERAGE'
  | 'SHORTAGE'
  | 'DATA_REVIEW';

export interface MaterialDemandGroup {
  materialId: string | null;
  orderItemIds: string[];
  productIds: string[];
  orderedQty: number | null;
  netShippedQty: number | null;
  remainingQty: number | null;
  onHandQty: number | null;
  openWorkOrderQty: number | null;
  onHandGapQty: number | null;
  projectedGapQty: number | null;
  assessment: FulfillmentAssessment;
  issues: string[];
}

export interface FulfillmentEvidence {
  assessment: FulfillmentAssessment;
  issues: string[];
  materialDemandGroups: MaterialDemandGroup[];
  stockBasis: 'UNRESERVED_SNAPSHOT';
  workOrderBasis: 'UNFINISHED_NOT_ETA';
}

export interface FulfillmentLedgerRow {
  id: string;
  companyId: string;
  materialId: string;
  referenceNo: string | null;
  type: string;
  quantity: unknown;
}

export interface FulfillmentOrder {
  id: string;
  orderNo: string;
  items: Array<{ id: string; productId: string; quantity: unknown }>;
  workOrders: Array<{
    productId: string;
    plannedQty: unknown;
    actualQty: unknown;
  }>;
}

/** Prefix SQL is only candidate selection: numeric cycle validation is mandatory. */
export function shipmentDirection(orderNo: string, row: FulfillmentLedgerRow) {
  if (row.type === 'OUTBOUND' && row.referenceNo === `SALE-SHIP-${orderNo}`) {
    return 1;
  }
  const reversal = `SALE-SHIP-REV-${orderNo}`;
  if (
    row.type === 'INBOUND' &&
    (row.referenceNo === reversal ||
      (row.referenceNo?.startsWith(`${reversal}-`) &&
        /^[1-9]\d*$/.test(row.referenceNo.slice(reversal.length + 1))))
  ) {
    return -1;
  }
  return 0;
}

const validQuantity = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;

/** No per-item shipment allocation, reservation, write, or delivery-date prediction. */
export function buildFulfillmentEvidence(
  companyId: string,
  order: FulfillmentOrder,
  products: Map<
    string,
    { materialId: string | null; materialCompanyId?: string | null }
  >,
  onHandByMaterial: Map<string, number>,
  ledger: FulfillmentLedgerRow[],
  reversalOwners: Map<string, string | null>,
): FulfillmentEvidence {
  const groups = new Map<string, MaterialDemandGroup>();
  const issues = new Set<string>();
  for (const item of order.items) {
    const product = products.get(item.productId);
    const materialId = product?.materialId ?? null;
    const key = materialId ?? `unmapped:${item.productId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        materialId,
        orderItemIds: [],
        productIds: [],
        orderedQty: 0,
        netShippedQty: 0,
        remainingQty: null,
        onHandQty: materialId ? (onHandByMaterial.get(materialId) ?? 0) : null,
        openWorkOrderQty: materialId ? 0 : null,
        onHandGapQty: null,
        projectedGapQty: null,
        assessment: 'DATA_REVIEW',
        issues: [],
      };
      groups.set(key, group);
    }
    group.orderItemIds.push(item.id);
    if (!group.productIds.includes(item.productId))
      group.productIds.push(item.productId);
    if (!product) group.issues.push('MISSING_OR_INACTIVE_PRODUCT');
    else if (!materialId) group.issues.push('UNMAPPED_PRODUCT');
    else if (
      product.materialCompanyId &&
      product.materialCompanyId !== companyId
    )
      group.issues.push('FOREIGN_MATERIAL_MAPPING');
    if (!validQuantity(item.quantity)) {
      group.issues.push('INVALID_ORDER_QUANTITY');
      group.orderedQty = null;
    } else if (group.orderedQty !== null)
      group.orderedQty = roundQuantity(
        group.orderedQty + Number(item.quantity),
      );
  }
  if (!groups.size) issues.add('EMPTY_ORDER');
  for (const workOrder of order.workOrders) {
    const materialId = products.get(workOrder.productId)?.materialId;
    const group = materialId ? groups.get(materialId) : undefined;
    if (!group) {
      issues.add('UNMATCHED_WORK_ORDER_PRODUCT');
      continue;
    }
    if (
      !validQuantity(workOrder.plannedQty) ||
      !validQuantity(workOrder.actualQty)
    ) {
      group.issues.push('INVALID_WORK_ORDER_QUANTITY');
      group.openWorkOrderQty = null;
    } else if (group.openWorkOrderQty !== null) {
      group.openWorkOrderQty = roundQuantity(
        group.openWorkOrderQty +
          Math.max(
            Number(workOrder.plannedQty) - Number(workOrder.actualQty),
            0,
          ),
      );
    }
  }
  for (const row of ledger) {
    if (row.companyId !== companyId) continue;
    const ownedReversal =
      row.type === 'INBOUND' &&
      reversalOwners.get(row.id) === order.id &&
      row.referenceNo?.startsWith(`SALE-SHIP-REV-${order.orderNo}-`);
    const direction = ownedReversal
      ? -1
      : shipmentDirection(order.orderNo, row);
    if (!direction) continue;
    if (direction === -1) {
      const owner = reversalOwners.get(row.id);
      if (!owner) {
        issues.add('AMBIGUOUS_REVERSAL_OWNERSHIP');
        continue;
      }
      if (owner !== order.id) continue;
    }
    const group = groups.get(row.materialId);
    if (!group) {
      issues.add('UNMATCHED_SHIPMENT_MATERIAL');
      continue;
    }
    if (!validQuantity(row.quantity))
      group.issues.push('INVALID_SHIPMENT_QUANTITY');
    else
      group.netShippedQty = roundQuantity(
        (group.netShippedQty ?? 0) + direction * Number(row.quantity),
      );
  }
  for (const group of groups.values()) {
    if (group.materialId !== null && !validQuantity(group.onHandQty)) {
      group.issues.push('INVALID_STOCK_QUANTITY');
      group.onHandQty = null;
    }
    if (
      (group.netShippedQty ?? 0) < 0 ||
      (group.orderedQty !== null &&
        (group.netShippedQty ?? 0) > group.orderedQty)
    ) {
      group.issues.push('INVALID_NET_SHIPPED_QUANTITY');
    }
    // A historical material no longer mapped to demand cannot be attributed safely.
    if (issues.has('UNMATCHED_SHIPMENT_MATERIAL'))
      group.issues.push('UNMATCHED_SHIPMENT_MATERIAL');
    if (issues.has('AMBIGUOUS_REVERSAL_OWNERSHIP'))
      group.issues.push('AMBIGUOUS_REVERSAL_OWNERSHIP');
    group.issues = [...new Set(group.issues)];
    if (group.issues.length) {
      group.netShippedQty = null;
      group.issues.forEach((issue) => issues.add(issue));
      continue;
    }
    group.remainingQty = roundQuantity(
      (group.orderedQty ?? 0) - (group.netShippedQty ?? 0),
    );
    group.onHandGapQty = roundQuantity(
      Math.max(0, group.remainingQty - (group.onHandQty ?? 0)),
    );
    group.projectedGapQty = roundQuantity(
      Math.max(0, group.onHandGapQty - (group.openWorkOrderQty ?? 0)),
    );
    group.assessment =
      group.remainingQty === 0
        ? 'FULFILLED'
        : group.onHandGapQty === 0
          ? 'ON_HAND_COVERAGE'
          : group.projectedGapQty === 0
            ? 'WORK_ORDER_COVERAGE'
            : 'SHORTAGE';
  }
  const materialDemandGroups = [...groups.values()];
  const assessment: FulfillmentAssessment = issues.size
    ? 'DATA_REVIEW'
    : materialDemandGroups.some((group) => group.assessment === 'SHORTAGE')
      ? 'SHORTAGE'
      : materialDemandGroups.some(
            (group) => group.assessment === 'WORK_ORDER_COVERAGE',
          )
        ? 'WORK_ORDER_COVERAGE'
        : materialDemandGroups.some(
              (group) => group.assessment === 'ON_HAND_COVERAGE',
            )
          ? 'ON_HAND_COVERAGE'
          : 'FULFILLED';
  return {
    assessment,
    issues: [...issues],
    materialDemandGroups,
    stockBasis: 'UNRESERVED_SNAPSHOT',
    workOrderBasis: 'UNFINISHED_NOT_ETA',
  };
}
