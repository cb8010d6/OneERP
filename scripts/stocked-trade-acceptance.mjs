#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15_000;

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--report') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--report requires a file path');
      }
      args.report = value;
      index += 1;
      continue;
    }
    if (item.startsWith('--report=')) {
      args.report = item.slice('--report='.length);
      if (!args.report) throw new Error('--report requires a file path');
      continue;
    }
    throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

export function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  );
}

export function normalizeApiBaseUrl(rawUrl) {
  if (!rawUrl?.trim()) throw new Error('API_BASE_URL is required');

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('API_BASE_URL must be a valid loopback URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API_BASE_URL must use HTTP or HTTPS');
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('API_BASE_URL must target localhost, 127.0.0.1, or [::1]');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API_BASE_URL cannot contain credentials, query, or fragment');
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') pathname = '/api';
  else if (pathname !== '/api') {
    throw new Error('API_BASE_URL path must be empty, /, or /api');
  }
  return `${url.origin}${pathname}`;
}

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (env.STOCKED_TRADE_ACCEPTANCE !== '1') {
    throw new Error('Set STOCKED_TRADE_ACCEPTANCE=1 to explicitly enable this HTTP UAT');
  }

  const baseUrl = normalizeApiBaseUrl(env.API_BASE_URL);
  const email = env.BUSINESS_ACCEPTANCE_ADMIN_EMAIL?.trim();
  const password = env.BUSINESS_ACCEPTANCE_ADMIN_PASSWORD;
  const companyName = env.BUSINESS_ACCEPTANCE_COMPANY_NAME?.trim();
  if (!email) throw new Error('BUSINESS_ACCEPTANCE_ADMIN_EMAIL is required');
  if (!password) throw new Error('BUSINESS_ACCEPTANCE_ADMIN_PASSWORD is required');
  if (!companyName) throw new Error('BUSINESS_ACCEPTANCE_COMPANY_NAME is required');

  const timeoutValue = Number(env.STOCKED_TRADE_HTTP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutValue) || timeoutValue < 250 || timeoutValue > 120_000) {
    throw new Error('STOCKED_TRADE_HTTP_TIMEOUT_MS must be an integer from 250 to 120000');
  }

  return {
    baseUrl,
    email,
    password,
    companyName,
    timeoutMs: timeoutValue,
    reportPath: args.report || env.STOCKED_TRADE_ACCEPTANCE_REPORT || '',
  };
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function asNumber(value, label) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw new Error(`${label} was missing`);
  }
  const parsed = Number(value);
  assertCondition(Number.isFinite(parsed), `${label} was not numeric`);
  return parsed;
}

export function snapshotStockMovement(transaction, label) {
  const snapshot = {};
  for (const field of ['id', 'type', 'referenceNo', 'materialId']) {
    assertCondition(
      typeof transaction?.[field] === 'string' && transaction[field].trim(),
      `${label} ${field} was missing or invalid`,
    );
    snapshot[field] = transaction[field];
  }
  // Prisma Decimal quantities arrive as strings; compare their numeric value,
  // without rounding away a change to the recorded movement.
  snapshot.quantity = asNumber(transaction.quantity, `${label} quantity`);
  for (const field of ['sourceLocationId', 'destLocationId', 'batchNo']) {
    const value = transaction[field] ?? null;
    assertCondition(value === null || typeof value === 'string', `${label} ${field} was invalid`);
    snapshot[field] = value;
  }
  return snapshot;
}

export function assertStockMovementUnchanged(transaction, expected, label) {
  const actual = snapshotStockMovement(transaction, label);
  for (const [field, value] of Object.entries(expected)) {
    assertCondition(actual[field] === value, `${label} changed ${field}`);
  }
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

function resourceRows(response, label) {
  const rows = Array.isArray(response) ? response : response?.data;
  assertCondition(Array.isArray(rows), `${label} response did not contain a data array`);
  return rows;
}

function queryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export class ApiClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.accessToken = '';
    this.companyId = '';
  }

  setAuth(accessToken, companyId) {
    this.accessToken = accessToken;
    this.companyId = companyId;
  }

  async request(method, route, body, { allowFailure = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (this.companyId) headers['x-company-id'] = this.companyId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    let responseBody = null;
    try {
      response = await fetch(`${this.baseUrl}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      const rawBody = await response.text();
      if (rawBody) {
        try {
          responseBody = JSON.parse(rawBody);
        } catch {
          responseBody = rawBody;
        }
      }
    } catch {
      throw new Error(`${method} ${route} failed or timed out after ${this.timeoutMs} ms`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok && !allowFailure) {
      throw new Error(`${method} ${route} returned HTTP ${response.status}`);
    }
    return { status: response.status, ok: response.ok, body: responseBody };
  }

  async get(route, params = {}) {
    return (await this.request('GET', `${route}${queryString(params)}`)).body;
  }

  async post(route, body) {
    return (await this.request('POST', route, body)).body;
  }

  async postExpectStatus(route, body, expectedStatus) {
    const response = await this.request('POST', route, body, { allowFailure: true });
    assertCondition(
      response.status === expectedStatus,
      `POST ${route} returned HTTP ${response.status}; expected HTTP ${expectedStatus}`,
    );
    return response;
  }
}

class StepRecorder {
  constructor() {
    this.steps = [];
  }

  async run(name, fn) {
    try {
      const result = await fn();
      const step = {
        name,
        passed: true,
        detail: result?.detail ?? 'ok',
        data: result?.data,
        checkedAt: new Date().toISOString(),
      };
      this.steps.push(step);
      console.log(`[PASS] ${name} - ${step.detail}`);
      return result?.value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.steps.push({
        name,
        passed: false,
        detail,
        checkedAt: new Date().toISOString(),
      });
      console.error(`[FAIL] ${name} - ${detail}`);
      throw error;
    }
  }
}

function makeRunSuffix() {
  return `UAT-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
}

async function getLedgerQty(api, materialId, locationId, { missingAsZero = false } = {}) {
  const response = await api.get('/inventory/realtime-ledger', { page: 1, limit: 100 });
  const rows = resourceRows(response, 'Inventory ledger');
  const row = rows.find(
    (item) => item.materialId === materialId && item.locationId === locationId,
  );
  if (!row && missingAsZero) return 0;
  assertCondition(row, 'Expected material/location row was missing from inventory ledger');
  return roundQuantity(asNumber(row.netQty, 'Inventory ledger netQty'));
}

async function getPurchaseOrder(api, id) {
  return api.get(`/purchase/orders/${encodeURIComponent(id)}`);
}

async function findTransactions(api, referenceNo, type) {
  const rows = resourceRows(await api.get('/inventory/transactions'), 'Inventory transactions');
  return rows.filter((item) => item.referenceNo === referenceNo && item.type === type);
}

function createReport(recorder, startedAt, context, error) {
  const endedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10,
    passed: !error && recorder.steps.every((step) => step.passed),
    context,
    steps: recorder.steps,
  };
}

async function runJourney(config, recorder, context) {
  const api = new ApiClient(config.baseUrl, config.timeoutMs);
  const suffix = makeRunSuffix();
  context.records = {};
  context.sourceRevision = process.env.GITHUB_SHA || null;

  await recorder.run('api-health', async () => {
    const health = await api.get('/health');
    assertCondition(health?.status === 'ok', 'API health response status was not ok');
    return { detail: 'status=ok' };
  });

  await recorder.run('http-login-and-company-selection', async () => {
    const login = await api.post('/auth/login', {
      email: config.email,
      password: config.password,
    });
    const matches = (Array.isArray(login?.companies) ? login.companies : []).filter(
      (company) => company.name === config.companyName,
    );
    assertCondition(
      matches.length === 1,
      `Login must expose exactly one company named BUSINESS_ACCEPTANCE_COMPANY_NAME (found ${matches.length})`,
    );
    assertCondition(login?.accessToken, 'Login did not return an access token');
    assertCondition(matches[0]?.id, 'Selected login company did not return an id');
    api.setAuth(login.accessToken, matches[0].id);
    context.companyName = matches[0].name;
    context.companyId = matches[0].id;
    return { detail: `company=${matches[0].name}` };
  });

  const masterData = await recorder.run('create-synthetic-master-data', async () => {
    const partner = await api.post('/v1/resource/partner', {
      code: `${suffix}-PARTNER`,
      name: `${suffix} Supplier and Customer`,
      type: 'BOTH',
      isActive: true,
    });
    const material = await api.post('/v1/resource/material', {
      sku: `${suffix}-MAT`,
      name: `${suffix} Stocked Material`,
      category: 'UAT',
      unit: 'pcs',
      unitPrice: 10,
      minStock: 0,
    });
    const location = await api.post('/v1/resource/stockLocation', {
      name: `${suffix} Stock Location`,
      code: `${suffix}-LOC`,
    });
    const product = await api.post('/v1/resource/product', {
      sku: `${suffix}-PROD`,
      name: `${suffix} Stocked Product`,
      type: 'STOCKABLE',
      materialId: material.id,
      listPrice: 20,
      uom: 'pcs',
      isActive: true,
    });
    const taxCodes = resourceRows(
      await api.get('/v1/resource/taxCode', {
        page: 1,
        limit: 100,
        filter: { active: true, isDefault: true },
      }),
      'Active default tax codes',
    );
    assertCondition(
      taxCodes.length === 1 && taxCodes[0]?.id,
      `Expected exactly one active default tax code for the initialized tenant; found ${taxCodes.length}`,
    );

    for (const [label, record] of Object.entries({ partner, material, location, product })) {
      assertCondition(record?.id, `${label} creation did not return an id`);
    }
    assertCondition(product.materialId === material.id, 'Product is not mapped to the created material');
    context.records = {
      partnerId: partner.id,
      materialId: material.id,
      locationId: location.id,
      productId: product.id,
      taxCodeId: taxCodes[0].id,
    };
    return {
      detail: `partner=${partner.id} material=${material.id} location=${location.id} product=${product.id}`,
      data: { ...context.records },
      value: { partner, material, location, product, taxCode: taxCodes[0] },
    };
  });

  const purchaseOrder = await recorder.run('create-purchase-order', async () => {
    const created = await api.post('/purchase/orders', {
      supplierId: masterData.partner.id,
      items: [{ materialId: masterData.material.id, quantity: 10, unitPrice: 10 }],
      notes: `Stocked trade UAT ${suffix}`,
    });
    assertCondition(created?.id && created?.purchaseNo, 'Purchase order did not return id and purchaseNo');
    assertCondition(created.status === 'ORDERED', `Purchase order status was ${created.status}`);
    assertCondition(created.items?.[0]?.id, 'Purchase order did not return a line id');
    const stockQty = await getLedgerQty(
      api,
      masterData.material.id,
      masterData.location.id,
      { missingAsZero: true },
    );
    assertCondition(stockQty === 0, `Stock should be 0 before receipt, found ${stockQty}`);
    context.records.purchaseOrderId = created.id;
    context.records.purchaseNo = created.purchaseNo;
    context.records.purchaseOrderLineId = created.items[0].id;
    return {
      detail: `purchaseNo=${created.purchaseNo} status=${created.status}`,
      data: {
        purchaseOrderId: created.id,
        purchaseNo: created.purchaseNo,
        orderedQty: 10,
        stockQty,
      },
      value: created,
    };
  });

  await recorder.run('receive-partial-quantity-and-check-stock', async () => {
    await api.post(`/purchase/orders/${encodeURIComponent(purchaseOrder.id)}/receive`, {
      lines: [{
        purchaseOrderLineId: purchaseOrder.items[0].id,
        quantity: 4,
        destLocationId: masterData.location.id,
        batchNo: `${suffix}-BATCH`,
      }],
      note: `Synthetic first receipt ${suffix}`,
    });
    const order = await getPurchaseOrder(api, purchaseOrder.id);
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(order.status === 'PARTIAL_RECEIVED', `Purchase order status was ${order.status}`);
    assertCondition(roundQuantity(order.items?.[0]?.receivedQty) === 4, 'Received quantity was not 4');
    assertCondition(order.receipts?.length === 1, 'Expected one purchase receipt after first receipt');
    assertCondition(qty === 4, `Expected stock quantity 4 after first receipt, found ${qty}`);
    const receipt = order.receipts[0];
    assertCondition(receipt?.receiptNo, 'Purchase receipt did not return receiptNo');
    context.records.firstReceiptNo = receipt.receiptNo;
    return {
      detail: `status=${order.status} receivedQty=4 stockQty=${qty}`,
      data: { receiptNo: receipt.receiptNo, receivedQty: 4, stockQty: qty },
    };
  });

  await recorder.run('reject-over-receipt-without-changing-data', async () => {
    await api.postExpectStatus(`/purchase/orders/${encodeURIComponent(purchaseOrder.id)}/receive`, {
      lines: [{
        purchaseOrderLineId: purchaseOrder.items[0].id,
        quantity: 7,
        destLocationId: masterData.location.id,
        batchNo: `${suffix}-BATCH`,
      }],
      note: `Expected over-receipt rejection ${suffix}`,
    }, 400);
    const order = await getPurchaseOrder(api, purchaseOrder.id);
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(order.status === 'PARTIAL_RECEIVED', 'Rejected receipt changed the purchase order status');
    assertCondition(roundQuantity(order.items?.[0]?.receivedQty) === 4, 'Rejected receipt changed received quantity');
    assertCondition(order.receipts?.length === 1, 'Rejected receipt created a receipt record');
    assertCondition(qty === 4, `Rejected receipt changed stock quantity to ${qty}`);
    return { detail: `HTTP 400; receivedQty=4 stockQty=${qty}` };
  });

  const salesOrder = await recorder.run('create-sales-order', async () => {
    const created = await api.post('/orders', {
      partnerId: masterData.partner.id,
      taxCodeId: masterData.taxCode.id,
      items: [{ productId: masterData.product.id, quantity: 6 }],
    });
    assertCondition(created?.id && created?.orderNo, 'Sales order did not return id and orderNo');
    assertCondition(created.status === 'DRAFT', `Sales order status was ${created.status}`);
    assertCondition(created.taxCodeId === masterData.taxCode.id, 'Sales order did not retain the explicit active default tax code');
    context.records.salesOrderId = created.id;
    context.records.orderNo = created.orderNo;
    return {
      detail: `orderNo=${created.orderNo} status=${created.status}`,
      data: { salesOrderId: created.id, orderNo: created.orderNo, orderedQty: 6 },
      value: created,
    };
  });

  await recorder.run('reject-shipment-when-stock-is-insufficient', async () => {
    await api.postExpectStatus(`/inventory/posting/sale-order/${encodeURIComponent(salesOrder.id)}/ship`, {
      sourceLocationId: masterData.location.id,
      batchNo: `${suffix}-BATCH`,
      items: [{ productId: masterData.product.id, shipQuantity: 6 }],
      allowPartial: false,
      note: `Expected insufficient-stock rejection ${suffix}`,
    }, 400);
    const [order, qty, shipments] = await Promise.all([
      api.get(`/orders/${encodeURIComponent(salesOrder.id)}`),
      getLedgerQty(api, masterData.material.id, masterData.location.id),
      findTransactions(api, `SALE-SHIP-${salesOrder.orderNo}`, 'OUTBOUND'),
    ]);
    assertCondition(order.status === 'DRAFT', `Rejected shipment changed order status to ${order.status}`);
    assertCondition(qty === 4, `Rejected shipment changed stock quantity to ${qty}`);
    assertCondition(shipments.length === 0, 'Rejected shipment created an outbound transaction');
    return { detail: `HTTP 400; status=${order.status} stockQty=${qty} shipmentMoves=0` };
  });

  await recorder.run('receive-remaining-quantity-and-check-stock', async () => {
    const order = await api.post(`/purchase/orders/${encodeURIComponent(purchaseOrder.id)}/receive`, {
      lines: [{
        purchaseOrderLineId: purchaseOrder.items[0].id,
        quantity: 6,
        destLocationId: masterData.location.id,
        batchNo: `${suffix}-BATCH`,
      }],
      note: `Synthetic final receipt ${suffix}`,
    });
    const qty = await getLedgerQty(api, masterData.material.id, masterData.location.id);
    assertCondition(order.status === 'RECEIVED', `Purchase order status was ${order.status}`);
    assertCondition(roundQuantity(order.items?.[0]?.receivedQty) === 10, 'Total received quantity was not 10');
    assertCondition(order.receipts?.length === 2, 'Expected two purchase receipts after final receipt');
    assertCondition(qty === 10, `Expected stock quantity 10 after final receipt, found ${qty}`);
    context.records.secondReceiptNo = order.receipts.find(
      (receipt) => receipt.receiptNo !== context.records.firstReceiptNo,
    )?.receiptNo;
    assertCondition(context.records.secondReceiptNo, 'Second receipt number was not returned');
    return {
      detail: `status=${order.status} receivedQty=10 stockQty=${qty}`,
      data: { receiptNo: context.records.secondReceiptNo, receivedQty: 10, stockQty: qty },
    };
  });

  let shipmentMovement;
  let reversalMovement;
  await recorder.run('ship-sales-order-and-check-stock', async () => {
    const shipment = await api.post(`/inventory/posting/sale-order/${encodeURIComponent(salesOrder.id)}/ship`, {
      sourceLocationId: masterData.location.id,
      batchNo: `${suffix}-BATCH`,
      items: [{ productId: masterData.product.id, shipQuantity: 6 }],
      allowPartial: false,
      note: `Synthetic sale shipment ${suffix}`,
    });
    const [order, qty, transactions] = await Promise.all([
      api.get(`/orders/${encodeURIComponent(salesOrder.id)}`),
      getLedgerQty(api, masterData.material.id, masterData.location.id),
      findTransactions(api, `SALE-SHIP-${salesOrder.orderNo}`, 'OUTBOUND'),
    ]);
    assertCondition(Array.isArray(shipment?.postedLines) && shipment.postedLines.length === 1, 'Shipment did not return one posted line');
    assertCondition(order.status === 'SHIPPED', `Sales order status was ${order.status}`);
    assertCondition(qty === 4, `Expected stock quantity 4 after shipment, found ${qty}`);
    assertCondition(transactions.length === 1, `Expected one sales shipment transaction, found ${transactions.length}`);
    const transaction = transactions[0];
    assertCondition(roundQuantity(asNumber(transaction.quantity, 'Sales shipment quantity')) === 6, 'Sales shipment transaction quantity was not 6');
    shipmentMovement = snapshotStockMovement(transaction, 'Sales shipment movement');
    context.records.shipmentTransactionId = transaction.id;
    return {
      detail: `status=${order.status} shippedQty=6 stockQty=${qty}`,
      data: { status: order.status, shippedQty: 6, stockQty: qty, transactionId: transaction.id },
    };
  });

  let reversal;
  await recorder.run('reverse-sales-shipment-and-check-stock', async () => {
    reversal = await api.post(`/inventory/posting/sale-order/${encodeURIComponent(salesOrder.id)}/reverse`, {
      destLocationId: masterData.location.id,
      note: `Synthetic UAT correction ${suffix}`,
    });
    const [order, qty, outboundTransactions, reversalTransactions] = await Promise.all([
      api.get(`/orders/${encodeURIComponent(salesOrder.id)}`),
      getLedgerQty(api, masterData.material.id, masterData.location.id),
      findTransactions(api, `SALE-SHIP-${salesOrder.orderNo}`, 'OUTBOUND'),
      findTransactions(api, `SALE-SHIP-REV-${salesOrder.orderNo}`, 'INBOUND'),
    ]);
    assertCondition(order.status === 'IN_PRODUCTION', `Reversed sales order status was ${order.status}`);
    assertCondition(qty === 10, `Expected stock quantity 10 after reversal, found ${qty}`);
    assertCondition(reversal?.returnDocument?.id, 'Shipment reversal did not return a return document id');
    assertCondition(Array.isArray(reversal?.reversedLines) && reversal.reversedLines.length === 1, 'Shipment reversal did not return one reversed line');
    assertCondition(outboundTransactions.length === 1, 'Original shipment transaction was missing or duplicated after reversal');
    assertStockMovementUnchanged(outboundTransactions[0], shipmentMovement, 'Original shipment after reversal');
    assertCondition(reversalTransactions.length === 1, `Expected one reversal transaction, found ${reversalTransactions.length}`);
    const transaction = reversalTransactions[0];
    assertCondition(roundQuantity(asNumber(transaction.quantity, 'Reversal quantity')) === 6, 'Reversal transaction quantity was not 6');
    reversalMovement = snapshotStockMovement(transaction, 'Reversal movement');
    context.records.returnDocumentId = reversal.returnDocument.id;
    context.records.reversalTransactionId = transaction.id;
    return {
      detail: `status=${order.status} reversedQty=6 stockQty=${qty}`,
      data: {
        status: order.status,
        reversedQty: 6,
        stockQty: qty,
        returnDocumentId: reversal.returnDocument.id,
        transactionId: transaction.id,
      },
    };
  });

  await recorder.run('reversal-replay-is-idempotent', async () => {
    const replay = await api.post(`/inventory/posting/sale-order/${encodeURIComponent(salesOrder.id)}/reverse`, {
      destLocationId: masterData.location.id,
      note: `Synthetic UAT correction replay ${suffix}`,
    });
    const [order, qty, outboundTransactions, reversalTransactions] = await Promise.all([
      api.get(`/orders/${encodeURIComponent(salesOrder.id)}`),
      getLedgerQty(api, masterData.material.id, masterData.location.id),
      findTransactions(api, `SALE-SHIP-${salesOrder.orderNo}`, 'OUTBOUND'),
      findTransactions(api, `SALE-SHIP-REV-${salesOrder.orderNo}`, 'INBOUND'),
    ]);
    assertCondition(order.status === 'IN_PRODUCTION', `Reversal replay changed status to ${order.status}`);
    assertCondition(replay?.returnDocument?.id === reversal.returnDocument.id, 'Replay did not return the original return document');
    assertCondition(Array.isArray(replay?.reversedLines) && replay.reversedLines.length === 0, 'Replay created additional reversed lines');
    assertCondition(qty === 10, `Reversal replay changed stock quantity to ${qty}`);
    assertCondition(outboundTransactions.length === 1, 'Replay changed or duplicated the original shipment transaction');
    assertStockMovementUnchanged(outboundTransactions[0], shipmentMovement, 'Original shipment after replay');
    assertCondition(reversalTransactions.length === 1, `Replay left ${reversalTransactions.length} reversal transactions; expected exactly one`);
    assertStockMovementUnchanged(reversalTransactions[0], reversalMovement, 'Reversal movement after replay');
    return {
      detail: `sameReturnDocument=true additionalMoves=0 stockQty=${qty}`,
      data: { returnDocumentId: replay.returnDocument.id, stockQty: qty, additionalMoves: 0 },
    };
  });

  await recorder.run('verify-purchase-receipt-source-transactions', async () => {
    const refs = [context.records.firstReceiptNo, context.records.secondReceiptNo].map(
      (receiptNo) => `PURCHASE-IN-${purchaseOrder.purchaseNo}-${receiptNo}`,
    );
    const transactionSets = await Promise.all(
      refs.map((referenceNo) => findTransactions(api, referenceNo, 'INBOUND')),
    );
    assertCondition(transactionSets.every((items) => items.length === 1), 'One or more receipt transactions were missing or duplicated');
    const transactions = transactionSets.map((items) => items[0]);
    assertCondition(transactions.every((item) => typeof item.id === 'string' && item.id.trim()), 'A receipt transaction id was missing or invalid');
    const receiptQuantities = transactions.map((item) => roundQuantity(asNumber(item.quantity, 'Receipt quantity')));
    assertCondition(receiptQuantities[0] === 4, `First receipt quantity was ${receiptQuantities[0]}, expected 4`);
    assertCondition(receiptQuantities[1] === 6, `Second receipt quantity was ${receiptQuantities[1]}, expected 6`);
    assertCondition(
      receiptQuantities[0] + receiptQuantities[1] === 10,
      'Receipt inventory transaction quantities did not total 10',
    );
    return {
      detail: `purchaseNo=${purchaseOrder.purchaseNo} receiptTransactions=2 receivedQty=10`,
      data: {
        purchaseNo: purchaseOrder.purchaseNo,
        receiptNos: [context.records.firstReceiptNo, context.records.secondReceiptNo],
        quantities: receiptQuantities,
      },
    };
  });
}

async function main() {
  const startedAt = new Date();
  const recorder = new StepRecorder();
  const context = { records: {} };
  let config;
  let failure;

  try {
    config = loadConfig();
    await runJourney(config, recorder, context);
  } catch (error) {
    failure = error instanceof Error ? error : new Error('unknown error');
    if (!recorder.steps.length || recorder.steps.at(-1)?.passed) {
      recorder.steps.push({
        name: 'setup-or-journey',
        passed: false,
        detail: failure.message,
        checkedAt: new Date().toISOString(),
      });
      console.error(`[FAIL] setup-or-journey - ${failure.message}`);
    }
  }

  const report = createReport(recorder, startedAt, context, failure);
  if (config?.reportPath) {
    const reportPath = path.resolve(config.reportPath);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Report: ${reportPath}`);
  }
  console.log(`HTTP UAT ${report.passed ? 'PASSED' : 'FAILED'} (${report.steps.filter((step) => step.passed).length}/${report.steps.length} steps)`);
  if (failure) process.exitCode = 1;
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;
if (isDirectExecution) {
  await main();
}
