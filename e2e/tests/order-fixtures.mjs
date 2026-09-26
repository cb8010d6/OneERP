import { test as workspaceTest, expect } from './fixtures.mjs';

export const orderId = 'synthetic-order-evidence';
export const productId = 'synthetic-product';
export const materialId = '00000000-0000-4000-8000-000000000001';
export const materialName = 'Synthetic Finished Widget';
export const orderPath = `/dashboard/orders/${orderId}`;

function evidence(shipped) {
  return {
    assessment: shipped ? 'FULFILLED' : 'ON_HAND_COVERAGE',
    issues: [], stockBasis: 'UNRESERVED_SNAPSHOT', workOrderBasis: 'UNFINISHED_NOT_ETA',
    materialDemandGroups: [{
      materialId, materialName, materialSku: 'SYN-WIDGET', materialUnit: '件',
      orderItemIds: ['synthetic-order-line'], productIds: [productId],
      orderedQty: 10, netShippedQty: shipped ? 10 : 6, remainingQty: shipped ? 0 : 4,
      onHandQty: shipped ? 0 : 4, openWorkOrderQty: 0,
      onHandGapQty: 0, projectedGapQty: 0,
      assessment: shipped ? 'FULFILLED' : 'ON_HAND_COVERAGE', issues: [],
    }],
  };
}

export const test = workspaceTest.extend({
  orderApi: [async ({ page }, use) => {
    const state = {
      expectedShipment: null,
      postedPayloads: [],
      failAvailabilityAfterShipment: false,
      reads: { order: 0, availability: 0, timeline: 0 },
      events: [],
    };
    await page.route('**/api/proxy/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      // Unmatched requests fall through to the original fail-closed fixture.
      if (url.origin !== 'http://127.0.0.1:3100' || url.search ||
          request.headers()['x-company-id'] !== 'synthetic-a') return route.fallback();
      const path = url.pathname.replace(/^\/api\/proxy/, '');
      const shipped = state.postedPayloads.length > 0;
      if (request.method() === 'GET') {
        if (path === `/orders/${orderId}`) {
          state.reads.order += 1;
          state.events.push('order');
          return route.fulfill({ json: {
            id: orderId, orderNo: 'SYN-ORDER-001', status: shipped ? 'SHIPPED' : 'PARTIAL_SHIPPED',
            totalAmount: 100, expectedDate: null, notes: 'Synthetic browser fixture only',
            createdAt: '2026-01-01T12:00:00Z',
            partner: { id: 'synthetic-customer', name: 'Synthetic Customer', contact: 'Synthetic Contact', phone: '000' },
            salesPerson: { id: 'synthetic-user', name: 'Synthetic UI Tester' },
            items: [{ id: 'synthetic-order-line', productId, quantity: 10, unitPrice: 10, totalPrice: 100 }],
            workOrders: [], invoices: [],
          } });
        }
        if (path === `/orders/${orderId}/fulfillment-availability`) {
          state.reads.availability += 1;
          state.events.push('availability');
          if (shipped && state.failAvailabilityAfterShipment) {
            return route.fulfill({ status: 503, json: { message: 'Synthetic availability read failure' } });
          }
          return route.fulfill({ json: { fulfillmentEvidence: evidence(shipped) } });
        }
        if (path === `/orders/${orderId}/timeline`) {
          state.reads.timeline += 1;
          state.events.push('timeline');
          return route.fulfill({ json: { events: shipped ? [{
            id: 'synthetic-posted-event', action: 'SYNTHETIC_SHIPMENT_REFRESHED',
            createdAt: '2026-01-02T12:00:00Z', user: { name: 'Synthetic UI Tester' },
          }] : [] } });
        }
        if (path === '/inventory/locations') {
          return route.fulfill({ json: [{ id: 'synthetic-location', name: 'Synthetic Stock Location' }] });
        }
        if (path === '/inventory/returns') return route.fulfill({ json: [] });
      }
      if (request.method() === 'POST' && state.expectedShipment && !shipped &&
          path === `/inventory/posting/sale-order/${orderId}/ship`) {
        const payload = request.postDataJSON();
        expect(payload, 'Only the explicitly expected synthetic shipment payload is allowed').toEqual(state.expectedShipment);
        state.postedPayloads.push(payload);
        state.events.push('shipment');
        // This is a browser-local mocked response, never a backend write.
        return route.fulfill({ json: {
          status: 'SHIPPED', postingStatus: 'POSTED', message: 'Synthetic shipment response only',
          postedLines: [{ productId, requestedQuantity: 4, quantity: 4, allocations: [{ batchNo: 'SYN-BATCH', quantity: 4 }] }],
          skippedLines: [],
        } });
      }
      return route.fallback();
    });
    await use(state);
  }, { auto: true }],
});
export { expect };
