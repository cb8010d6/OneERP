export const fulfillmentAssessments = [
  'FULFILLED',
  'ON_HAND_COVERAGE',
  'WORK_ORDER_COVERAGE',
  'SHORTAGE',
  'DATA_REVIEW',
] as const;

export type FulfillmentAssessment = (typeof fulfillmentAssessments)[number];

export interface FulfillmentMaterialDemandGroup {
  materialId: string | null;
  materialName?: string | null;
  materialSku?: string | null;
  materialUnit?: string | null;
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
  materialDemandGroups: FulfillmentMaterialDemandGroup[];
  stockBasis: 'UNRESERVED_SNAPSHOT';
  workOrderBasis: 'UNFINISHED_NOT_ETA';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssessment(value: unknown): value is FulfillmentAssessment {
  return (
    typeof value === 'string' &&
    fulfillmentAssessments.includes(value as FulfillmentAssessment)
  );
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function parseMaterialDemandGroup(
  value: unknown,
): FulfillmentMaterialDemandGroup | null {
  if (!isRecord(value)) return null;
  if (!(value.materialId === null || typeof value.materialId === 'string'))
    return null;
  if (
    !isOptionalNullableString(value.materialName) ||
    !isOptionalNullableString(value.materialSku) ||
    !isOptionalNullableString(value.materialUnit)
  ) {
    return null;
  }
  if (!isStringArray(value.orderItemIds) || !isStringArray(value.productIds))
    return null;
  if (
    !isNullableFiniteNumber(value.orderedQty) ||
    !isNullableFiniteNumber(value.netShippedQty) ||
    !isNullableFiniteNumber(value.remainingQty) ||
    !isNullableFiniteNumber(value.onHandQty) ||
    !isNullableFiniteNumber(value.openWorkOrderQty) ||
    !isNullableFiniteNumber(value.onHandGapQty) ||
    !isNullableFiniteNumber(value.projectedGapQty)
  ) {
    return null;
  }
  if (!isAssessment(value.assessment) || !isStringArray(value.issues)) return null;

  return {
    materialId: value.materialId,
    materialName: typeof value.materialName === 'string' ? value.materialName : null,
    materialSku: typeof value.materialSku === 'string' ? value.materialSku : null,
    materialUnit: typeof value.materialUnit === 'string' ? value.materialUnit : null,
    orderItemIds: value.orderItemIds,
    productIds: value.productIds,
    orderedQty: value.orderedQty,
    netShippedQty: value.netShippedQty,
    remainingQty: value.remainingQty,
    onHandQty: value.onHandQty,
    openWorkOrderQty: value.openWorkOrderQty,
    onHandGapQty: value.onHandGapQty,
    projectedGapQty: value.projectedGapQty,
    assessment: value.assessment,
    issues: value.issues,
  };
}

/**
 * Parse only the additive evidence contract. Older availability responses,
 * incomplete payloads, and unknown assessment values deliberately return null.
 */
export function parseFulfillmentEvidence(
  value: unknown,
): FulfillmentEvidence | null {
  if (!isRecord(value)) return null;
  if (!isAssessment(value.assessment) || !isStringArray(value.issues)) return null;
  if (
    value.stockBasis !== 'UNRESERVED_SNAPSHOT' ||
    value.workOrderBasis !== 'UNFINISHED_NOT_ETA' ||
    !Array.isArray(value.materialDemandGroups)
  ) {
    return null;
  }

  const groups = value.materialDemandGroups.map(parseMaterialDemandGroup);
  if (groups.some((group) => group === null)) return null;

  return {
    assessment: value.assessment,
    issues: value.issues,
    materialDemandGroups: groups as FulfillmentMaterialDemandGroup[],
    stockBasis: value.stockBasis,
    workOrderBasis: value.workOrderBasis,
  };
}

export function canReadOrderEvidenceLink(
  permissions: readonly string[],
  required: string,
): boolean {
  if (
    permissions.includes('ALL') ||
    permissions.includes('*:*') ||
    permissions.includes(required)
  ) {
    return true;
  }
  const [resource, action] = required.split(':');
  if (!resource || !action) return false;
  return (
    permissions.includes(`${resource}:*`) || permissions.includes(`*:${action}`)
  );
}

/** Keep the API's four-decimal quantity precision for the request payload. */
export function roundShipmentQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function aggregateShipmentQuantitiesByProduct<T extends {
  productId: string;
  shipQuantity: number;
}>(items: readonly T[]): Array<{ productId: string; shipQuantity: number }> {
  const quantities = new Map<string, number>();

  for (const item of items) {
    if (!Number.isFinite(item.shipQuantity) || item.shipQuantity <= 0) continue;
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.shipQuantity);
  }

  return [...quantities].map(([productId, rawQuantity]) => ({
    productId,
    shipQuantity: roundShipmentQuantity(rawQuantity),
  }));
}
