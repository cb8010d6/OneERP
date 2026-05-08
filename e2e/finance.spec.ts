import { test, expect } from '@playwright/test';
import {
  loginUser,
  authHeaders,
  createResource,
  createOrder,
  createInvoice,
  postInvoice,
  listResources,
  uniquePartnerCode,
  uniqueSku,
  type AuthResult,
  type CrudRecord,
} from './helpers';

test.describe('发票过账与凭证借贷平衡', () => {
  let auth: AuthResult;
  let headers: Record<string, string>;
  let partnerId: string;
  let productId: string;
  let orderId: string;
  let invoiceId: string;

  test.beforeAll(async ({ request }) => {
    auth = await loginUser(request, 'admin@erp.com', 'admin');
    headers = authHeaders(auth);

    // 创建伙伴
    const partner: CrudRecord = await createResource(request, 'Partner', {
      code: uniquePartnerCode(),
      name: '财务测试客户',
      type: 'CUSTOMER',
    }, headers);
    partnerId = partner.id;

    // 创建产品
    const prod: CrudRecord = await createResource(request, 'Product', {
      sku: uniqueSku('PROD-FIN'),
      name: '财务测试产品',
      type: 'SERVICE',
      uom: 'pcs',
    }, headers);
    productId = prod.id;

    // 创建订单
    const order: CrudRecord = await createOrder(request, headers, {
      partnerId,
      items: [{ productId, quantity: 10, unitPrice: 1000 }],
    });
    orderId = order.id;
  });

  test('5.1 创建应收发票', async ({ request }) => {
    const invoice: CrudRecord = await createInvoice(request, headers, {
      orderId,
      amount: 10000,
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    expect(invoice.id).toBeTruthy();
    expect(invoice.invoiceNo).toBeTruthy();
    expect(invoice.status).toBe('UNPAID');
    expect(invoice.postingStatus ?? invoice.postingstatus).toBeDefined();
    invoiceId = invoice.id;
  });

  test('5.2 查询发票列表', async ({ request }) => {
    const result = await listResources(request, 'Invoice', headers);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const found = result.data.find((inv) => inv.id === invoiceId);
    expect(found).toBeTruthy();
  });

  test('5.3 发票过账: POST /finance/invoices/:id/post → 触发凭证生成', async ({
    request,
  }) => {
    const posted = await postInvoice(request, headers, invoiceId);
    expect(posted).toBeTruthy();

    // 过账后状态应为 POSTED
    const status = posted.postingStatus ?? posted.postingstatus;
    expect(status).toBe('POSTED');
  });

  test('5.4 过账后查询凭证分录行 (JournalEntryLine): 借贷应平衡', async ({
    request,
  }) => {
    // 查询所有凭证分录行
    const result = await listResources(request, 'JournalEntryLine', headers, {
      limit: '100',
    });

    expect(result.data.length).toBeGreaterThanOrEqual(2); // 至少一行借一行贷

    // 按 journalEntryId 分组，检查每组借贷是否平衡
    const grouped = new Map<
      string,
      Array<{ debit: number; credit: number }>
    >();
    for (const line of result.data) {
      const entryId = line.journalEntryId as string;
      if (!grouped.has(entryId)) grouped.set(entryId, []);
      grouped.get(entryId)!.push({
        debit: Number(line.debit ?? 0),
        credit: Number(line.credit ?? 0),
      });
    }

    // 找到与我们发票相关的凭证（最新的那组）
    const lastEntry = Array.from(grouped.values()).pop();
    expect(lastEntry).toBeTruthy();
    expect(lastEntry!.length).toBeGreaterThanOrEqual(2);

    const totalDebit = lastEntry!.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lastEntry!.reduce((sum, l) => sum + l.credit, 0);

    // 借贷平衡: 借方合计 === 贷方合计（允许 0.01 精度误差）
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.02);
    // 至少有一方不为 0
    expect(totalDebit).toBeGreaterThan(0);
    expect(totalCredit).toBeGreaterThan(0);
  });

  test('5.5 重复过账同一发票 → 幂等返回', async ({ request }) => {
    const res = await request.post(`/finance/invoices/${invoiceId}/post`, {
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // 应返回已过账的消息
    expect(body.message ?? body.postingStatus).toBeTruthy();
  });

  test('5.6 登记发票收款', async ({ request }) => {
    const res = await request.post(`/finance/invoices/${invoiceId}/payments`, {
      data: { amount: 10000, method: 'BANK_TRANSFER' },
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const payment = await res.json();
    expect(payment.amount).toBe(10000);
    expect(payment.method).toBe('BANK_TRANSFER');
  });

  test('5.7 收款后发票状态应变为 PAID', async ({ request }) => {
    const result = await listResources(request, 'Invoice', headers);
    const inv = result.data.find((i) => i.id === invoiceId);
    expect(inv).toBeTruthy();
    expect(inv!.status).toBe('PAID');
  });
});
