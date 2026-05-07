import { test, expect } from '@playwright/test';
import {
  loginUser,
  authHeaders,
  createResource,
  listResources,
  uniquePartnerCode,
  uniqueSku,
  type AuthResult,
  type CrudRecord,
} from './helpers';

test.describe('采购订单到应付账款完整链路', () => {
  let auth: AuthResult;
  let headers: Record<string, string>;
  let materialId: string;
  let partnerId: string;
  let purchaseOrderId: string;
  let purchaseOrderNo: string;

  test.beforeAll(async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    headers = authHeaders(auth);

    // 创建测试供应商
    const code = uniquePartnerCode();
    const partner: CrudRecord = await createResource(request, 'Partner', {
      code,
      name: `E2E供应商-${code}`,
      type: 'SUPPLIER',
      contact: 'E2E测试',
      phone: '13800000000',
    }, headers);
    partnerId = partner.id;

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
  });

  test('4.1 创建采购订单: POST /purchase-orders', async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        partnerId,
        expectedDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        notes: 'E2E 自动测试采购单',
        lines: [
          {
            materialId,
            quantity: 100,
            unitPrice: 25.5,
            taxRate: 0.13,
          },
        ],
      },
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.orderNo).toBeTruthy();
    expect(body.status).toBe('DRAFT');
    expect(body.lines.length).toBe(1);
    purchaseOrderId = body.id;
    purchaseOrderNo = body.orderNo;
  });

  test('4.2 查询采购订单列表: GET /purchase-orders', async ({ request }) => {
    const res = await request.get('/purchase-orders', { headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const found = body.data.find(
      (po: { id: string }) => po.id === purchaseOrderId,
    );
    expect(found).toBeTruthy();
  });

  test('4.3 查询采购订单详情: GET /purchase-orders/:id', async ({
    request,
  }) => {
    const res = await request.get(`/purchase-orders/${purchaseOrderId}`, {
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.orderNo).toBe(purchaseOrderNo);
    expect(body.partnerId).toBe(partnerId);
    expect(body.lines.length).toBe(1);
    expect(Number(body.lines[0].unitPrice)).toBeCloseTo(25.5, 1);
  });

  test('4.4 采购订单通过通用 CRUD 查询: GET /v1/resource/purchaseOrder', async ({
    request,
  }) => {
    const list = await listResources(request, 'purchaseOrder', headers);
    expect(list.data.length).toBeGreaterThanOrEqual(1);
    const found = list.data.find(
      (po: { id: string }) => po.id === purchaseOrderId,
    );
    expect(found).toBeTruthy();
  });

  test('4.5 提交采购订单: PATCH /purchase-orders/:id/submit', async ({
    request,
  }) => {
    const res = await request.patch(
      `/purchase-orders/${purchaseOrderId}/submit`,
      { headers },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('SUBMITTED');
  });

  test('4.6 确认采购订单: PATCH /purchase-orders/:id/confirm', async ({
    request,
  }) => {
    const res = await request.patch(
      `/purchase-orders/${purchaseOrderId}/confirm`,
      { headers },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('APPROVED');
  });
});