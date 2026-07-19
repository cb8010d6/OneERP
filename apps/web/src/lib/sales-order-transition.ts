export function requiresSalesShipmentWorkbench(
  modelName: string,
  fromStatus: string,
  toStatus: string,
) {
  const normalized = modelName.toLowerCase();
  return (
    (normalized === 'order' || normalized === 'sale_order') &&
    fromStatus === 'IN_PRODUCTION' &&
    toStatus === 'SHIPPED'
  );
}

export function isSalesShipmentWorkbenchStatus(status: string) {
  return status === 'IN_PRODUCTION' || status === 'PARTIAL_SHIPPED';
}

export function canCancelSalesOrder(status: string) {
  return !['PARTIAL_SHIPPED', 'SHIPPED', 'COMPLETED', 'CANCELLED'].includes(
    status,
  );
}
