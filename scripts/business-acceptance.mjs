#!/usr/bin/env node
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date();
const steps = [];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const [rawKey, inlineValue] = item.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function readEnvFile(envFile) {
  const env = {};
  if (!existsSync(envFile)) return env;

  for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...valueParts] = line.split('=');
    env[key.trim()] = valueParts.join('=').trim().replace(/^"|"$/g, '');
  }
  return env;
}

function addStep(name, passed, detail, data) {
  steps.push({
    name,
    passed,
    detail,
    data,
    checkedAt: new Date().toISOString(),
  });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name} - ${detail}`);
}

function failStep(name, error) {
  addStep(name, false, error instanceof Error ? error.message : String(error));
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      query.set(key, JSON.stringify(value));
    } else {
      query.set(key, String(value));
    }
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = '';
    this.companyId = '';
  }

  setAuth(token, companyId) {
    this.token = token;
    this.companyId = companyId;
  }

  async request(method, route, body, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.companyId) headers['x-company-id'] = this.companyId;

    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await readResponseBody(response);
    if (!response.ok && !options.allowFailure) {
      const message =
        typeof responseBody === 'object' && responseBody !== null
          ? responseBody.message ?? JSON.stringify(responseBody)
          : String(responseBody ?? response.statusText);
      throw new Error(`${method} ${route} failed: ${response.status} ${message}`);
    }
    return { status: response.status, ok: response.ok, body: responseBody };
  }

  async get(route, params) {
    return (await this.request('GET', `${route}${makeQuery(params ?? {})}`)).body;
  }

  async post(route, body, options) {
    return (await this.request('POST', route, body, options)).body;
  }

  async postExpectFailure(route, body) {
    return this.request('POST', route, body, { allowFailure: true });
  }
}

async function withStep(name, fn) {
  try {
    const result = await fn();
    addStep(name, true, result?.detail ?? 'ok', result?.data);
    return result?.value;
  } catch (error) {
    failStep(name, error);
    throw error;
  }
}

async function poll(fn, { timeoutMs = 15000, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error(`${label} 超时`);
}

async function createResource(api, modelName, body) {
  return api.post(`/v1/resource/${modelName}`, body);
}

async function listResource(api, modelName, params = {}) {
  return api.get(`/v1/resource/${modelName}`, params);
}

async function getLedgerQty(api, materialId, locationId) {
  const ledger = await api.get('/inventory/realtime-ledger');
  const rows = Array.isArray(ledger) ? ledger : Array.isArray(ledger?.data) ? ledger.data : [];
  const row = rows.find(
    (item) => item.materialId === materialId && item.locationId === locationId,
  );
  return roundMoney(getNumber(row?.netQty));
}

async function findInventoryTransaction(api, referenceNo, type) {
  const response = await api.get('/inventory/transactions');
  const rows = Array.isArray(response)
    ? response
    : Array.isArray(response?.data)
      ? response.data
      : [];
  return rows.find((item) => item.referenceNo === referenceNo && item.type === type);
}

async function findPostedJournalEntry(api, invoiceNo) {
  const entries = await listResource(api, 'journalEntry', {
    page: 1,
    limit: 20,
    filter: { ref: invoiceNo, postingStatus: 'POSTED', journal: { code: 'SAL' } },
    include: { journal: true },
  });
  const entry = entries.data?.[0];
  if (!entry) return null;

  const lines = await listResource(api, 'journalEntryLine', {
    page: 1,
    limit: 20,
    filter: { journalEntryId: entry.id },
    include: { account: true },
    orderBy: { lineNo: 'asc' },
  });

  return {
    ...entry,
    lines: Array.isArray(lines.data) ? lines.data : [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(root, args.envFile ?? process.env.ENV_FILE ?? '.env');
  const env = readEnvFile(envFile);
  const apiPort = env.API_PORT || process.env.API_PORT || '8000';
  const apiBaseUrl =
    args.apiBaseUrl || process.env.API_BASE_URL || `http://localhost:${apiPort}/api`;
  const email =
    args.email || process.env.INIT_ADMIN_EMAIL || env.INIT_ADMIN_EMAIL || '';
  const password =
    args.password ||
    process.env.INIT_ADMIN_PASSWORD ||
    env.INIT_ADMIN_PASSWORD ||
    '';
  const reportPath = path.resolve(
    root,
    args.report || process.env.BUSINESS_ACCEPTANCE_REPORT || 'business-acceptance-report.json',
  );

  const api = new ApiClient(apiBaseUrl);
  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`.toUpperCase();
  const context = {
    envFile,
    apiBaseUrl,
    suffix,
    companyId: '',
    records: {},
  };

  await withStep('api-health', async () => {
    const health = await api.get('/health');
    return { detail: `status=${health?.status ?? 'unknown'}`, data: health };
  });

  await withStep('api-login', async () => {
    assertCondition(email, '缺少 INIT_ADMIN_EMAIL 或 --email');
    assertCondition(password, '缺少 INIT_ADMIN_PASSWORD 或 --password');
    const login = await api.post('/auth/login', { email, password });
    const token = login?.accessToken;
    const companyId = login?.companies?.[0]?.id;
    assertCondition(token, '登录成功但未返回 accessToken');
    assertCondition(companyId, '登录成功但未返回公司');
    api.setAuth(token, companyId);
    context.companyId = companyId;
    return { detail: `user=${email} company=${companyId}` };
  });

  const masterData = await withStep('prepare-master-data', async () => {
    const partner = await createResource(api, 'partner', {
      code: `BA-CUST-${suffix}`,
      name: `业务验收客户 ${suffix}`,
      type: 'CUSTOMER',
      contact: '验收员',
      phone: '13800000000',
      email: `ba-${suffix.toLowerCase()}@oneerp.local`,
      address: '业务验收地址',
    });
    const warehouse = await createResource(api, 'warehouse', {
      name: `业务验收仓 ${suffix}`,
      type: 'FINISHED',
    });
    const location = await createResource(api, 'stockLocation', {
      name: `业务验收库位 ${suffix}`,
      code: `BA-LOC-${suffix}`,
      usage: 'INTERNAL',
      isActive: true,
      warehouseId: warehouse.id,
    });
    const material = await createResource(api, 'material', {
      sku: `BA-MAT-${suffix}`,
      name: `业务验收物料 ${suffix}`,
      category: '验收',
      unit: 'pcs',
      minStock: 0,
      unitPrice: 10,
    });
    const product = await createResource(api, 'product', {
      sku: `BA-PROD-${suffix}`,
      name: `业务验收产品 ${suffix}`,
      type: 'STOCKABLE',
      materialId: material.id,
      uom: 'pcs',
      description: '业务数据验收专用产品',
      isActive: true,
    });
    context.records = {
      partnerId: partner.id,
      warehouseId: warehouse.id,
      locationId: location.id,
      materialId: material.id,
      productId: product.id,
    };
    return {
      detail: `partner=${partner.id} material=${material.id} product=${product.id}`,
      value: { partner, warehouse, location, material, product },
    };
  });

  const purchaseNo = `BA-PO-${suffix}`;
  const batchNo = `BA-BATCH-${suffix}`;
  await withStep('purchase-receipt-increases-inventory', async () => {
    const inbound = await api.post('/inventory/posting/purchase/inbound', {
      purchaseNo,
      materialId: masterData.material.id,
      quantity: 10,
      destLocationId: masterData.location.id,
      batchNo,
      note: '业务验收采购收货',
    });
    assertCondition(inbound?.transactionId, '采购入库未返回 transactionId');
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(qty === 10, `采购入库后库存应为 10，实际为 ${qty}`);
    const transaction = await findInventoryTransaction(
      api,
      `PURCHASE-IN-${purchaseNo}`,
      'INBOUND',
    );
    assertCondition(transaction, '未找到采购入库流水');
    assertCondition(roundMoney(transaction.quantity) === 10, '采购入库流水数量不是 10');
    return {
      detail: `qty=${qty} transaction=${transaction.id}`,
      data: { inbound, transactionId: transaction.id },
    };
  });

  const order = await withStep('create-sales-order', async () => {
    const created = await api.post('/orders', {
      partnerId: masterData.partner.id,
      items: [{ productId: masterData.product.id, quantity: 4, unitPrice: 113 }],
      aiSummary: { source: 'business-acceptance', suffix },
      notes: '业务验收销售订单',
    });
    assertCondition(created?.id, '销售订单未返回 id');
    assertCondition(created?.orderNo, '销售订单未返回 orderNo');
    assertCondition(roundMoney(created.totalAmount) === 452, '销售订单金额不是 452');
    return {
      detail: `order=${created.orderNo} amount=${created.totalAmount}`,
      value: created,
    };
  });

  await withStep('sales-shipment-rejects-insufficient-stock', async () => {
    const largeOrder = await api.post('/orders', {
      partnerId: masterData.partner.id,
      items: [{ productId: masterData.product.id, quantity: 999, unitPrice: 1 }],
      aiSummary: { source: 'business-acceptance-insufficient', suffix },
      notes: '业务验收库存不足订单',
    });
    const response = await api.postExpectFailure(
      `/inventory/posting/sale-order/${largeOrder.id}/ship`,
      {
        sourceLocationId: masterData.location.id,
        batchNo,
        note: '业务验收库存不足拒绝',
      },
    );
    assertCondition(!response.ok, '库存不足出库被错误放行');
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(qty === 10, `库存不足拒绝后库存应保持 10，实际为 ${qty}`);
    return {
      detail: `rejectedStatus=${response.status} qty=${qty}`,
      data: response.body,
    };
  });

  await withStep('sales-shipment-deducts-inventory', async () => {
    const shipment = await api.post(`/inventory/posting/sale-order/${order.id}/ship`, {
      sourceLocationId: masterData.location.id,
      batchNo,
      note: '业务验收销售发货',
    });
    assertCondition(
      Array.isArray(shipment?.postedLines) && shipment.postedLines.length === 1,
      '销售出库未返回 1 条 postedLines',
    );
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(qty === 6, `销售出库后库存应为 6，实际为 ${qty}`);
    const transaction = await findInventoryTransaction(
      api,
      `SALE-SHIP-${order.orderNo}`,
      'OUTBOUND',
    );
    assertCondition(transaction, '未找到销售出库流水');
    assertCondition(roundMoney(transaction.quantity) === 4, '销售出库流水数量不是 4');
    const detail = await api.get(`/orders/${order.id}`);
    assertCondition(detail?.status === 'SHIPPED', `订单状态应为 SHIPPED，实际为 ${detail?.status}`);
    return {
      detail: `qty=${qty} transaction=${transaction.id}`,
      data: { shipment, transactionId: transaction.id },
    };
  });

  const invoice = await withStep('invoice-posting-creates-balanced-entry', async () => {
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const created = await api.post('/finance/invoices', {
      orderId: order.id,
      amount: 452,
      dueDate,
    });
    assertCondition(created?.id, '发票未返回 id');
    const posted = await api.post(`/finance/invoices/${created.id}/post`, {});
    assertCondition(posted?.postingStatus === 'POSTED', '发票未进入 POSTED 状态');
    const entry = await poll(() => findPostedJournalEntry(api, created.invoiceNo), {
      label: '等待发票过账凭证',
    });
    assertCondition(entry.lines.length >= 2, '发票凭证明细少于 2 行');
    const totalDebit = roundMoney(
      entry.lines.reduce((sum, line) => sum + getNumber(line.debit), 0),
    );
    const totalCredit = roundMoney(
      entry.lines.reduce((sum, line) => sum + getNumber(line.credit), 0),
    );
    assertCondition(totalDebit > 0, '发票凭证借方金额为 0');
    assertCondition(totalDebit === totalCredit, `发票凭证借贷不平: ${totalDebit}/${totalCredit}`);
    return {
      detail: `invoice=${created.invoiceNo} entry=${entry.entryNo} debit=${totalDebit} credit=${totalCredit}`,
      data: { invoice: created, posted, journalEntryId: entry.id },
      value: created,
    };
  });

  await withStep('trial-balance-is-balanced', async () => {
    const result = await api.get('/finance/trial-balance');
    assertCondition(result?.balanced === true, '试算平衡接口返回未平衡');
    assertCondition(roundMoney(result.totalDebit) === roundMoney(result.totalCredit), '试算平衡借贷合计不相等');
    assertCondition(getNumber(result.totalDebit) > 0, '试算平衡借方合计为 0');
    assertCondition(Array.isArray(result.rows) && result.rows.length > 0, '试算平衡没有科目行');
    return {
      detail: `debit=${result.totalDebit} credit=${result.totalCredit} diff=${result.difference}`,
      data: {
        invoiceNo: invoice.invoiceNo,
        totalDebit: result.totalDebit,
        totalCredit: result.totalCredit,
        difference: result.difference,
        rowCount: result.rows.length,
      },
    };
  });

  return context;
}

let context = {};
let exitCode = 0;
try {
  context = await main();
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  const endedAt = new Date();
  const report = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: roundMoney((endedAt.getTime() - startedAt.getTime()) / 1000),
    passed: steps.every((step) => step.passed),
    context,
    steps,
  };
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(
    root,
    args.report || process.env.BUSINESS_ACCEPTANCE_REPORT || 'business-acceptance-report.json',
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Report: ${reportPath}`);
}

process.exit(exitCode);
