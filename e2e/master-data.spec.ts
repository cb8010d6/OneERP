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

test.describe('主数据创建: 伙伴 / 物料 / 产品', () => {
  let auth: AuthResult;
  let headers: Record<string, string>;

  test.beforeAll(async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    headers = authHeaders(auth);
  });

  // ── 伙伴 (Partner) ────────────────────────────────────

  test('2.1 创建客户伙伴', async ({ request }) => {
    const code = uniquePartnerCode();
    const partner: CrudRecord = await createResource(request, 'Partner', {
      code,
      name: 'E2E测试客户',
      type: 'CUSTOMER',
      contact: '张三',
      phone: '13800001234',
      email: 'partner@test.com',
    }, headers);

    expect(partner.id).toBeTruthy();
    expect(partner.name).toBe('E2E测试客户');
    expect(partner.type).toBe('CUSTOMER');
  });

  test('2.2 创建供应商伙伴', async ({ request }) => {
    const code = uniquePartnerCode();
    const partner: CrudRecord = await createResource(request, 'Partner', {
      code,
      name: 'E2E测试供应商',
      type: 'SUPPLIER',
      contact: '李四',
      phone: '13900005678',
    }, headers);

    expect(partner.id).toBeTruthy();
    expect(partner.type).toBe('SUPPLIER');
  });

  test('2.3 查询伙伴列表', async ({ request }) => {
    const result = await listResources(request, 'Partner', headers);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  // ── 物料 (Material) ───────────────────────────────────

  test('2.4 创建物料', async ({ request }) => {
    const sku = uniqueSku('MAT');
    const material: CrudRecord = await createResource(request, 'Material', {
      sku,
      name: 'E2E测试不锈钢管',
      category: '管材',
      unit: 'm',
      minStock: 100,
      unitPrice: 25.5,
    }, headers);

    expect(material.id).toBeTruthy();
    expect(material.sku).toBe(sku);
    expect(material.name).toBe('E2E测试不锈钢管');
  });

  test('2.5 查询物料列表', async ({ request }) => {
    const res = await request.get('/inventory/materials', { headers });
    expect(res.ok()).toBeTruthy();
    const materials = await res.json();
    expect(Array.isArray(materials)).toBe(true);
  });

  // ── 产品 (Product) ────────────────────────────────────

  test('2.6 创建产品', async ({ request }) => {
    const sku = uniqueSku('PROD');
    const product: CrudRecord = await createResource(request, 'Product', {
      sku,
      name: 'E2E测试机柜组件',
      type: 'STOCKABLE',
      uom: 'pcs',
      description: '自动化E2E测试创建的产品',
    }, headers);

    expect(product.id).toBeTruthy();
    expect(product.sku).toBe(sku);
    expect(product.type).toBe('STOCKABLE');
  });

  test('2.7 查询产品列表', async ({ request }) => {
    const result = await listResources(request, 'Product', headers);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });
});
