import fs from 'node:fs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key?.startsWith('--')) args.set(key.slice(2), process.argv[index + 1]);
}

const envPath = args.get('env-file') ?? '.env';
const apiBaseUrl = (args.get('api-base-url') ?? 'http://127.0.0.1:18000/api').replace(/\/$/, '');
const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
const adminEmail = process.env.INIT_ADMIN_EMAIL ?? env.INIT_ADMIN_EMAIL;
const adminPassword = process.env.INIT_ADMIN_PASSWORD ?? env.INIT_ADMIN_PASSWORD;
const productId = args.get('product-id');
const orderId = args.get('order-id');
if (!adminEmail || !adminPassword) throw new Error('INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD are required');
if (!productId || !orderId) throw new Error('--product-id and --order-id are required');

async function request(path, options = {}, session = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(session.companyId ? { 'x-company-id': session.companyId } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && !options.allowFailure) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return options.allowFailure ? { status: response.status, body } : body;
}

async function login(email, password) {
  const body = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const companyId = body.companies?.[0]?.id;
  if (!body.accessToken || !companyId) throw new Error('Admin login did not return a company');
  return { token: body.accessToken, companyId };
}

const createResource = (session, model, data) =>
  request(`/v1/resource/${model}`, { method: 'POST', body: JSON.stringify(data) }, session);

async function ledgerQty(session, materialId, locationId) {
  const ledger = await request('/inventory/realtime-ledger', {}, session);
  const rows = Array.isArray(ledger) ? ledger : ledger?.data ?? [];
  return Number(
    rows.find((row) => row.materialId === materialId && row.locationId === locationId)?.netQty ?? 0,
  );
}

async function readWorkOrder(session, workOrderId) {
  const response = await request('/production/orders?page=1&limit=100', {}, session);
  return response.data?.find((item) => item.id === workOrderId);
}

const admin = await login(adminEmail, adminPassword);
const suffix = Date.now().toString(36).toUpperCase();
const warehouse = await createResource(admin, 'warehouse', {
  name: `报工事务验收仓 ${suffix}`,
  type: 'PRODUCTION',
});
const rawLocation = await createResource(admin, 'stockLocation', {
  name: `报工原料库位 ${suffix}`,
  code: `PR-RAW-${suffix}`,
  usage: 'INTERNAL',
  isActive: true,
  warehouseId: warehouse.id,
});
const emptyLocation = await createResource(admin, 'stockLocation', {
  name: `报工空库位 ${suffix}`,
  code: `PR-EMPTY-${suffix}`,
  usage: 'INTERNAL',
  isActive: true,
  warehouseId: warehouse.id,
});
const finishedLocation = await createResource(admin, 'stockLocation', {
  name: `报工成品库位 ${suffix}`,
  code: `PR-FG-${suffix}`,
  usage: 'INTERNAL',
  isActive: true,
  warehouseId: warehouse.id,
});
const rawMaterial = await createResource(admin, 'material', {
  sku: `PR-RAW-${suffix}`,
  name: `报工原料 ${suffix}`,
  category: 'UAT',
  unit: 'pcs',
  minStock: 0,
  unitPrice: 5,
});
const finishedMaterial = await createResource(admin, 'material', {
  sku: `PR-FG-${suffix}`,
  name: `报工成品 ${suffix}`,
  category: 'UAT',
  unit: 'pcs',
  minStock: 0,
  unitPrice: 20,
});
await request(
  `/v1/resource/product/${productId}`,
  { method: 'PUT', body: JSON.stringify({ materialId: finishedMaterial.id }) },
  admin,
);
const bom = await createResource(admin, 'bom', {
  code: `PR-BOM-${suffix}`,
  productId,
  version: 'UAT-1',
  isDefault: true,
});
await createResource(admin, 'bomLine', {
  bomId: bom.id,
  materialId: rawMaterial.id,
  quantity: 1,
  scrapRate: 0,
  note: '原子报工 UAT',
});
await request(
  '/inventory/posting/purchase/inbound',
  {
    method: 'POST',
    body: JSON.stringify({
      purchaseNo: `PR-IN-${suffix}`,
      materialId: rawMaterial.id,
      quantity: 5,
      destLocationId: rawLocation.id,
      batchNo: `PR-BATCH-${suffix}`,
      note: '原子报工 UAT 原料入库',
    }),
  },
  admin,
);

const releasedDocuments = await request(
  `/engineering-documents/released-for-order/${orderId}`,
  {},
  admin,
);
const releasedDocument = releasedDocuments.find(
  (document) => document.product?.id === productId && document.currentReleasedRevision?.id,
);
if (!releasedDocument) throw new Error('No released engineering revision is available for the UAT product');
const workOrder = await request(
  '/production/orders',
  {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      productId,
      plannedQty: 2,
      engineeringRevisionIds: [releasedDocument.currentReleasedRevision.id],
    }),
  },
  admin,
);

const failedKey = crypto.randomUUID();
const failed = await request(
  `/production/orders/${workOrder.id}/report`,
  {
    method: 'POST',
    allowFailure: true,
    body: JSON.stringify({
      idempotencyKey: failedKey,
      goodQty: 1,
      defectQty: 0,
      sourceLocationId: emptyLocation.id,
      destLocationId: finishedLocation.id,
    }),
  },
  admin,
);
if (failed.status < 400) throw new Error('Inventory failure did not reject the work report');
let currentWorkOrder = await readWorkOrder(admin, workOrder.id);
if (currentWorkOrder?.actualQty !== 0) throw new Error('Failed inventory posting changed work order progress');
if ((await ledgerQty(admin, finishedMaterial.id, finishedLocation.id)) !== 0) {
  throw new Error('Failed inventory posting changed finished stock');
}

const firstKey = crypto.randomUUID();
const firstPayload = {
  idempotencyKey: firstKey,
  goodQty: 1,
  defectQty: 0,
  sourceLocationId: rawLocation.id,
  destLocationId: finishedLocation.id,
  batchNo: `PR-FG-BATCH-${suffix}`,
};
const first = await request(
  `/production/orders/${workOrder.id}/report`,
  { method: 'POST', body: JSON.stringify(firstPayload) },
  admin,
);
if (first.idempotentReplay || first.inventoryTransactionIds?.length !== 2) {
  throw new Error('First work report did not atomically create two inventory transactions');
}
const afterFirst = {
  raw: await ledgerQty(admin, rawMaterial.id, rawLocation.id),
  finished: await ledgerQty(admin, finishedMaterial.id, finishedLocation.id),
};
if (afterFirst.raw !== 4 || afterFirst.finished !== 1) {
  throw new Error(`Unexpected stock after first report: ${JSON.stringify(afterFirst)}`);
}

const replay = await request(
  `/production/orders/${workOrder.id}/report`,
  { method: 'POST', body: JSON.stringify(firstPayload) },
  admin,
);
if (!replay.idempotentReplay || replay.id !== first.id) {
  throw new Error('Same-payload replay did not return the original work report');
}
if (
  (await ledgerQty(admin, rawMaterial.id, rawLocation.id)) !== 4 ||
  (await ledgerQty(admin, finishedMaterial.id, finishedLocation.id)) !== 1
) {
  throw new Error('Idempotent replay posted inventory twice');
}

const conflict = await request(
  `/production/orders/${workOrder.id}/report`,
  {
    method: 'POST',
    allowFailure: true,
    body: JSON.stringify({ ...firstPayload, goodQty: 2 }),
  },
  admin,
);
if (conflict.status !== 409) throw new Error(`Different-payload replay expected 409, got ${conflict.status}`);

const overReport = await request(
  `/production/orders/${workOrder.id}/report`,
  {
    method: 'POST',
    allowFailure: true,
    body: JSON.stringify({ ...firstPayload, idempotencyKey: crypto.randomUUID(), goodQty: 2 }),
  },
  admin,
);
if (overReport.status !== 400) throw new Error(`Over-report expected 400, got ${overReport.status}`);

const second = await request(
  `/production/orders/${workOrder.id}/report`,
  {
    method: 'POST',
    body: JSON.stringify({ ...firstPayload, idempotencyKey: crypto.randomUUID() }),
  },
  admin,
);
currentWorkOrder = await readWorkOrder(admin, workOrder.id);
const finalStock = {
  raw: await ledgerQty(admin, rawMaterial.id, rawLocation.id),
  finished: await ledgerQty(admin, finishedMaterial.id, finishedLocation.id),
};
if (
  second.idempotentReplay ||
  currentWorkOrder?.actualQty !== 2 ||
  currentWorkOrder?.status !== 'COMPLETED' ||
  finalStock.raw !== 3 ||
  finalStock.finished !== 2
) {
  throw new Error(
    `Second report did not complete atomically: ${JSON.stringify({ currentWorkOrder, finalStock })}`,
  );
}

const reversalPayload = {
  idempotencyKey: crypto.randomUUID(),
  reason: 'UAT 验证错误报工冲销',
};
const reversal = await request(
  `/production/reports/${second.id}/reverse`,
  { method: 'POST', body: JSON.stringify(reversalPayload) },
  admin,
);
currentWorkOrder = await readWorkOrder(admin, workOrder.id);
const stockAfterReversal = {
  raw: await ledgerQty(admin, rawMaterial.id, rawLocation.id),
  finished: await ledgerQty(admin, finishedMaterial.id, finishedLocation.id),
};
if (
  reversal.idempotentReplay ||
  reversal.inventoryTransactionIds?.length !== 2 ||
  currentWorkOrder?.actualQty !== 1 ||
  currentWorkOrder?.status !== 'IN_PROGRESS' ||
  stockAfterReversal.raw !== 4 ||
  stockAfterReversal.finished !== 1
) {
  throw new Error(
    `Work report reversal did not restore stock and progress: ${JSON.stringify({ currentWorkOrder, stockAfterReversal })}`,
  );
}
const reversalReplay = await request(
  `/production/reports/${second.id}/reverse`,
  { method: 'POST', body: JSON.stringify(reversalPayload) },
  admin,
);
if (!reversalReplay.idempotentReplay || reversalReplay.id !== reversal.id) {
  throw new Error('Work report reversal replay was not idempotent');
}
const reversalConflict = await request(
  `/production/reports/${second.id}/reverse`,
  {
    method: 'POST',
    allowFailure: true,
    body: JSON.stringify({ ...reversalPayload, reason: '不同冲销原因' }),
  },
  admin,
);
if (reversalConflict.status !== 409) {
  throw new Error(`Different-payload reversal expected 409, got ${reversalConflict.status}`);
}

await request(
  `/production/orders/${workOrder.id}/report`,
  {
    method: 'POST',
    body: JSON.stringify({ ...firstPayload, idempotencyKey: crypto.randomUUID() }),
  },
  admin,
);
currentWorkOrder = await readWorkOrder(admin, workOrder.id);
const stockAfterRepost = {
  raw: await ledgerQty(admin, rawMaterial.id, rawLocation.id),
  finished: await ledgerQty(admin, finishedMaterial.id, finishedLocation.id),
};
if (
  currentWorkOrder?.actualQty !== 2 ||
  currentWorkOrder?.status !== 'COMPLETED' ||
  stockAfterRepost.raw !== 3 ||
  stockAfterRepost.finished !== 2
) {
  throw new Error('Re-report after reversal did not complete the work order');
}

console.log(
  JSON.stringify({
    passed: true,
    workOrderNo: workOrder.workOrderNo,
    inventoryFailureRolledBack: true,
    idempotentReplay: true,
    differentPayloadConflict: true,
    overReportRejected: true,
    firstInventoryTransactions: first.inventoryTransactionIds.length,
    finalActualQty: currentWorkOrder.actualQty,
    finalStatus: currentWorkOrder.status,
    finalRawQty: finalStock.raw,
    finalFinishedQty: finalStock.finished,
    reversalInventoryTransactions: reversal.inventoryTransactionIds.length,
    reversalReplay: true,
    reversalDifferentPayloadConflict: true,
    stockRestoredAfterReversal: true,
    repostAfterReversal: true,
  }),
);

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
