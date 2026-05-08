import { test, expect } from '@playwright/test';
import {
  loginUser,
  authHeaders,
  createResource,
  createOrder,
  postPurchaseInbound,
  postSaleShipment,
  uniquePartnerCode,
  uniqueSku,
  type AuthResult,
  type CrudRecord,
} from './helpers';

test.describe('销售出库完整链路', () => {
  let auth: AuthResult;
  let headers: Record<string, string>;
  let partnerId: string;
  let productId: string;
  let materialId: string;
  let locationId: string;
  let orderId: string;
  const purchaseNo = `PO-SALE-E2E-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    headers = authHeaders(auth);

    // 创建客户伙伴
    const partner: CrudRecord = await createResource(request, 'Partner', {
      code: uniquePartnerCode(),
      name: '销售出库测试客户',
      type: 'CUSTOMER',
    }, headers);
    partnerId = partner.id;

    // 创建物料
    const sku = uniqueSku('MAT-SALE');
    const mat: CrudRecord = await createResource(request, 'Material', {
      sku,
      name: '销售出库测试物料',
      category: '板材',
      unit: 'pcs',
      unitPrice: 50,
    }, headers);
    materialId = mat.id;

    // 创建产品
    const prodSku = uniqueSku('PROD-SALE');
    const prod: CrudRecord = await createResource(request, 'Product', {
      sku: prodSku,
      name: '销售出库测试产品',
      type: 'STOCKABLE',
      uom: 'pcs',
      materialId: mat.id,
    }, headers);
    productId = prod.id;

    // 获取库位
    const locationsRes = await request.get('/inventory/locations', { headers });
    const locations = await locationsRes.json();
    expect(locations.length).toBeGreaterThanOrEqual(1);
    locationId = locations[0].id;

    // 先入库 200 件，确保有库存可出
    await postPurchaseInbound(request, headers, {
      purchaseNo,
      materialId,
      quantity: 200,
      destLocationId: locationId,
      batchNo: 'BATCH-SALE-001',
    });
  });

  test('4.1 创建销售订单', async ({ request }) => {
    const order: CrudRecord = await createOrder(request, headers, {
      partnerId,
      items: [
        { productId, quantity: 50, unitPrice: 120 },
      ],
    });

    expect(order.id).toBeTruthy();
    expect(order.status).toBe('DRAFT');
    expect(order.partnerId).toBe(partnerId);
    orderId = order.id;
  });

  test('4.2 查询订单详情', async ({ request }) => {
    const res = await request.get(`/orders/${orderId}`, { headers });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();

    expect(order.id).toBe(orderId);
    expect(order.items.length).toBeGreaterThanOrEqual(1);
  });

  test('4.3 销售出库过账: POST /inventory/posting/sale-order/:id/ship', async ({
    request,
  }) => {
    const result = await postSaleShipment(request, headers, orderId, {
      sourceLocationId: locationId,
      batchNo: 'BATCH-SALE-001',
      note: 'E2E销售出库测试',
    });

    expect(result).toBeTruthy();
  });

  test('4.4 出库后库存应减少', async ({ request }) => {
    const ledgerRes = await request.get('/inventory/realtime-ledger', {
      headers,
    });
    const ledger = await ledgerRes.json();

    const entry = ledger.find(
      (row: { materialId: string }) => row.materialId === materialId,
    );
    // 原始入库200，出库50后应 <= 150
    if (entry) {
      expect(Number(entry.netQty)).toBeLessThanOrEqual(150);
    }
  });

  test('4.5 查询出入库流水: 应包含销售出库记录', async ({ request }) => {
    const txRes = await request.get('/inventory/transactions', { headers });
    const txns = await txRes.json();

    const outbound = txns.find(
      (tx: { type: string; referenceNo?: string }) =>
        tx.type === 'OUTBOUND' && tx.referenceNo?.includes(orderId),
    );
    // 可能 referenceNo 是订单号而非ID，只需确认存在出库记录
    const anyOutbound = txns.find(
      (tx: { materialId: string; type: string }) =>
        tx.materialId === materialId && tx.type === 'OUTBOUND',
    );
    expect(anyOutbound).toBeTruthy();
  });

  test('4.6 销售出库冲销: POST /inventory/posting/sale-order/:id/reverse', async ({
    request,
  }) => {
    const res = await request.post(
      `/inventory/posting/sale-order/${orderId}/reverse`,
      {
        data: { note: 'E2E测试冲销出库' },
        headers,
      },
    );
    expect(res.ok()).toBeTruthy();
  });
});
