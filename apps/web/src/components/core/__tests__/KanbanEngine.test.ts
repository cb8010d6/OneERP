import {
  resolveTransitionAction,
} from '../KanbanEngine';
import {
  canCancelSalesOrder,
  isSalesShipmentWorkbenchStatus,
  requiresSalesShipmentWorkbench,
} from '@/lib/sales-order-transition';

describe('KanbanEngine order transition boundary', () => {
  it('blocks generic workflow shipping that would bypass inventory posting', () => {
    expect(
      requiresSalesShipmentWorkbench('Order', 'IN_PRODUCTION', 'SHIPPED'),
    ).toBe(true);
    expect(
      resolveTransitionAction('Order', 'IN_PRODUCTION', 'SHIPPED'),
    ).toBeNull();
  });

  it('keeps non-inventory order workflow transitions available', () => {
    expect(resolveTransitionAction('Order', 'DRAFT', 'PENDING')).toBe('submit');
    expect(resolveTransitionAction('Order', 'PENDING', 'IN_PRODUCTION')).toBe(
      'start_production',
    );
    expect(resolveTransitionAction('Order', 'SHIPPED', 'COMPLETED')).toBe(
      'complete',
    );
  });

  it('routes production and partial shipment orders to the shipment workbench', () => {
    expect(isSalesShipmentWorkbenchStatus('IN_PRODUCTION')).toBe(true);
    expect(isSalesShipmentWorkbenchStatus('PARTIAL_SHIPPED')).toBe(true);
    expect(isSalesShipmentWorkbenchStatus('SHIPPED')).toBe(false);
  });

  it('requires inventory correction before cancelling shipped orders', () => {
    expect(canCancelSalesOrder('DRAFT')).toBe(true);
    expect(canCancelSalesOrder('IN_PRODUCTION')).toBe(true);
    expect(canCancelSalesOrder('PARTIAL_SHIPPED')).toBe(false);
    expect(canCancelSalesOrder('SHIPPED')).toBe(false);
  });
});
