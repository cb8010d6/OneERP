import { test, expect } from '@playwright/test';
import {
  loginUser,
  authHeaders,
  createResource,
  postPurchaseInbound,
  listResources,
  uniquePartnerCode,
  uniqueSku,
  type AuthResult,
  type CrudRecord,
} from './helpers';

test.describe('采购入库完整链路', () => {
  let auth: AuthResult;
  let headers: Record<string, string>;
  let materialId: string;
  let locationId: string;
  const purchaseNo = `PO-E2E-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    headers = authHeaders(auth);

    // 创建测试物料
    const sku = uniqueSku('MAT-PO');
    const mat: CrudRecord = await createResource(request, 'Material', {
      sku,
      name: '采购入库测试物料',
      category: '管材',
      unit: 'kg',
      unitPrice: 10,
    }, headers);
    materialId = mat.id;

    // 获取仓库和库位
    const warehousesRes = await request.get('/inventory/warehouses', {
      headers,
    });
    const warehouses = await warehousesRes.json();
    expect(warehouses.length).toBeGreaterThanOrEqual(1);

    const locationsRes = await request.get('/inventory/locations', {
      headers,
    });
    const locations = await locationsRes.json();
    expect(locations.length).toBeGreaterThanOrEqual(1);
    locationId = locations[0].id;
  });

  test('3.1 采购入库过账: POST /inventory/posting/purchase/inbound', async ({
    request,
  }) => {
    const result = await postPurchaseInbound(request, headers, {
      purchaseNo,
      materialId,
      quantity: 500,
      destLocationId: locationId,
      batchNo: 'BATCH-E2E-001',
    });

    expect(result).toBeTruthy();
    // 返回创建的库存事务记录
    expect(result.materialId ?? result.type).toBeTruthy();
  });

  test('3.2 入库后查询库存台账: 物料数量应 >= 500', async ({ request }) => {
    const ledgerRes = await request.get('/inventory/realtime-ledger', {
      headers,
    });
    expect(ledgerRes.ok()).toBeTruthy();
    const ledger = await ledgerRes.json();

    // 查找我们刚入库的物料
    const entry = ledger.find(
      (row: { materialId: string }) => row.materialId === materialId,
    );
    expect(entry).toBeTruthy();
    expect(Number(entry.netQty)).toBeGreaterThanOrEqual(500);
  });

  test('3.3 查询出入库流水: 应包含本次采购入库记录', async ({
    request,
  }) => {
    const txRes = await request.get('/inventory/transactions', { headers });
    expect(txRes.ok()).toBeTruthy();
    const txns = await txRes.json();

    const inbound = txns.find(
      (tx: { materialId: string; type: string }) =>
        tx.materialId === materialId && tx.type === 'INBOUND',
    );
    expect(inbound).toBeTruthy();
    expect(Number(inbound.quantity)).toBe(500);
  });

  test('3.4 采购入库冲销: POST /inventory/posting/purchase/:purchaseNo/reverse', async ({
    request,
  }) => {
    const res = await request.post(
      `/inventory/posting/purchase/${purchaseNo}/reverse`,
      {
        data: { note: 'E2E测试冲销' },
        headers,
      },
    );
    expect(res.ok()).toBeTruthy();

    // 冲销后库存应减少
    const ledgerRes = await request.get('/inventory/realtime-ledger', {
      headers,
    });
    const ledger = await ledgerRes.json();
    const entry = ledger.find(
      (row: { materialId: string }) => row.materialId === materialId,
    );
    if (entry) {
      expect(Number(entry.netQty)).toBeLessThan(500);
    }
  });
});
