import type { APIRequestContext } from '@playwright/test';

// ─── 类型定义 ──────────────────────────────────────────────

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: { id: string; email: string; name: string };
  companies: Array<{ id: string; name: string; role: string }>;
}

export interface CrudRecord {
  id: string;
  [key: string]: unknown;
}

// ─── 认证辅助 ──────────────────────────────────────────────

/** 注册新用户并返回认证结果 */
export async function registerUser(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> {
  const res = await request.post('/auth/register', {
    data: { email, password, name },
  });
  if (!res.ok()) {
    throw new Error(`注册失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 登录并返回认证结果 */
export async function loginUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthResult> {
  const res = await request.post('/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`登录失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 生成带认证头的请求选项 */
export function authHeaders(
  auth: AuthResult,
  companyId?: string,
): Record<string, string> {
  const cid = companyId ?? auth.companies[0]?.id;
  if (!cid) throw new Error('无可用公司ID，请检查 auth.companies');
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    'x-company-id': cid,
  };
}

// ─── CRUD 辅助 ─────────────────────────────────────────────

/** 通过通用 CRUD 接口创建资源 */
export async function createResource(
  request: APIRequestContext,
  modelName: string,
  data: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<CrudRecord> {
  const res = await request.post(`/v1/resource/${modelName}`, {
    data,
    headers,
  });
  if (!res.ok()) {
    throw new Error(
      `创建 ${modelName} 失败 [${res.status()}]: ${await res.text()}`,
    );
  }
  return res.json();
}

/** 通过通用 CRUD 接口查询资源列表 */
export async function listResources(
  request: APIRequestContext,
  modelName: string,
  headers: Record<string, string>,
  params?: Record<string, string>,
): Promise<{ data: CrudRecord[]; total: number }> {
  const searchParams = new URLSearchParams(params);
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const res = await request.get(`/v1/resource/${modelName}${qs}`, {
    headers,
  });
  if (!res.ok()) {
    throw new Error(
      `查询 ${modelName} 失败 [${res.status()}]: ${await res.text()}`,
    );
  }
  return res.json();
}

// ─── 业务操作辅助 ──────────────────────────────────────────

/** 创建订单 */
export async function createOrder(
  request: APIRequestContext,
  headers: Record<string, string>,
  data: {
    partnerId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      taxCodeId?: string;
    }>;
    taxCodeId?: string;
  },
): Promise<CrudRecord> {
  const res = await request.post('/orders', { data, headers });
  if (!res.ok()) {
    throw new Error(`创建订单失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 创建发票 */
export async function createInvoice(
  request: APIRequestContext,
  headers: Record<string, string>,
  data: {
    orderId: string;
    amount: number;
    dueDate: string;
    taxCodeId?: string;
  },
): Promise<CrudRecord> {
  const res = await request.post('/finance/invoices', { data, headers });
  if (!res.ok()) {
    throw new Error(`创建发票失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 过账发票 */
export async function postInvoice(
  request: APIRequestContext,
  headers: Record<string, string>,
  invoiceId: string,
): Promise<CrudRecord> {
  const res = await request.post(`/finance/invoices/${invoiceId}/post`, {
    headers,
  });
  if (!res.ok()) {
    throw new Error(`过账发票失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 采购入库过账 */
export async function postPurchaseInbound(
  request: APIRequestContext,
  headers: Record<string, string>,
  data: {
    purchaseNo: string;
    materialId: string;
    quantity: number;
    destLocationId?: string;
    batchNo?: string;
  },
): Promise<CrudRecord> {
  const res = await request.post('/inventory/posting/purchase/inbound', {
    data,
    headers,
  });
  if (!res.ok()) {
    throw new Error(`采购入库失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 销售出库过账 */
export async function postSaleShipment(
  request: APIRequestContext,
  headers: Record<string, string>,
  orderId: string,
  data: {
    sourceLocationId?: string;
    batchNo?: string;
    note?: string;
  } = {},
): Promise<CrudRecord> {
  const res = await request.post(
    `/inventory/posting/sale-order/${orderId}/ship`,
    { data, headers },
  );
  if (!res.ok()) {
    throw new Error(`销售出库失败 [${res.status()}]: ${await res.text()}`);
  }
  return res.json();
}

/** 获取实时库存台账 */
export async function getRealtimeLedger(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<unknown[]> {
  const res = await request.get('/inventory/realtime-ledger', { headers });
  if (!res.ok()) {
    throw new Error(
      `获取库存台账失败 [${res.status()}]: ${await res.text()}`,
    );
  }
  return res.json();
}

/** 查询凭证分录行 (JournalEntryLine) */
export async function getJournalEntryLines(
  request: APIRequestContext,
  headers: Record<string, string>,
  params?: Record<string, string>,
): Promise<{ data: CrudRecord[]; total: number }> {
  return listResources(request, 'JournalEntryLine', headers, params);
}

// ─── 数据生成辅助 ──────────────────────────────────────────

/** 生成唯一邮箱 */
export function uniqueEmail(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`;
}

/** 生成唯一 SKU */
export function uniqueSku(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

/** 生成唯一伙伴代码 */
export function uniquePartnerCode(): string {
  return `P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}
