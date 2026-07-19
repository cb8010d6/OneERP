import fs from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key?.startsWith("--")) args.set(key.slice(2), process.argv[index + 1]);
}

const apiBaseUrl = (
  args.get("api-base-url") ?? "http://127.0.0.1:18000/api"
).replace(/\/$/, "");
const envPath = args.get("env-file") ?? ".env";
const env = fs.existsSync(envPath)
  ? parseEnv(fs.readFileSync(envPath, "utf8"))
  : {};
const adminEmail = process.env.INIT_ADMIN_EMAIL ?? env.INIT_ADMIN_EMAIL;
const adminPassword =
  process.env.INIT_ADMIN_PASSWORD ?? env.INIT_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword)
  throw new Error("INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD are required");

async function request(path, options = {}, session = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(session.companyId ? { "x-company-id": session.companyId } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && !options.allowFailure) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return options.allowFailure ? { status: response.status, body } : body;
}

async function login(email, password) {
  const body = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const companyId = body.companies?.[0]?.id;
  if (!body.accessToken || !companyId)
    throw new Error("Admin login did not return a company");
  return { token: body.accessToken, companyId };
}

const createResource = (session, model, data) =>
  request(
    `/v1/resource/${model}`,
    { method: "POST", body: JSON.stringify(data) },
    session,
  );

async function ledgerQty(session, materialId, locationId) {
  const ledger = await request("/inventory/realtime-ledger", {}, session);
  const rows = Array.isArray(ledger) ? ledger : (ledger?.data ?? []);
  return Number(
    rows.find(
      (row) => row.materialId === materialId && row.locationId === locationId,
    )?.netQty ?? 0,
  );
}

async function shipmentTransactions(session, referenceNo) {
  const response = await request(
    "/inventory/transactions?page=1&limit=200",
    {},
    session,
  );
  const rows = Array.isArray(response) ? response : (response?.data ?? []);
  return rows.filter(
    (row) => row.referenceNo === referenceNo && row.type === "OUTBOUND",
  );
}

async function transactionsByReferencePrefix(session, referencePrefix, type) {
  const response = await request(
    "/inventory/transactions?page=1&limit=200",
    {},
    session,
  );
  const rows = Array.isArray(response) ? response : (response?.data ?? []);
  return rows.filter(
    (row) =>
      String(row.referenceNo ?? "").startsWith(referencePrefix) &&
      row.type === type,
  );
}

const admin = await login(adminEmail, adminPassword);
const suffix = Date.now().toString(36).toUpperCase();
const batchNo = `SHIP-BATCH-${suffix}`;
const partner = await createResource(admin, "partner", {
  code: `SHIP-CUST-${suffix}`,
  name: `原子发货验收客户 ${suffix}`,
  type: "CUSTOMER",
});
const warehouse = await createResource(admin, "warehouse", {
  name: `原子发货验收仓 ${suffix}`,
  type: "FINISHED",
});
const location = await createResource(admin, "stockLocation", {
  name: `原子发货库位 ${suffix}`,
  code: `SHIP-${suffix}`,
  usage: "INTERNAL",
  isActive: true,
  warehouseId: warehouse.id,
});
const material = await createResource(admin, "material", {
  sku: `SHIP-MAT-${suffix}`,
  name: `原子发货共享物料 ${suffix}`,
  category: "UAT",
  unit: "pcs",
  minStock: 0,
  unitPrice: 10,
});
const firstProduct = await createResource(admin, "product", {
  sku: `SHIP-A-${suffix}`,
  name: `原子发货产品 A ${suffix}`,
  type: "STOCKABLE",
  materialId: material.id,
  listPrice: 10,
  uom: "pcs",
  isActive: true,
});
const secondProduct = await createResource(admin, "product", {
  sku: `SHIP-B-${suffix}`,
  name: `原子发货产品 B ${suffix}`,
  type: "STOCKABLE",
  materialId: material.id,
  listPrice: 10,
  uom: "pcs",
  isActive: true,
});
await request(
  "/inventory/move",
  {
    method: "POST",
    body: JSON.stringify({
      materialId: material.id,
      quantity: 1,
      destLocationId: location.id,
      batchNo,
      referenceNo: `SHIP-INITIAL-${suffix}`,
    }),
  },
  admin,
);
const order = await request(
  "/orders",
  {
    method: "POST",
    body: JSON.stringify({
      partnerId: partner.id,
      items: [
        { productId: firstProduct.id, quantity: 1, unitPrice: 10 },
        { productId: secondProduct.id, quantity: 1, unitPrice: 10 },
      ],
      notes: "默认整单发货原子性 UAT",
    }),
  },
  admin,
);
const shipmentPayload = {
  sourceLocationId: location.id,
  batchNo,
  items: [
    { productId: firstProduct.id, shipQuantity: 1 },
    { productId: secondProduct.id, shipQuantity: 1 },
  ],
};

const failed = await request(
  `/inventory/posting/sale-order/${order.id}/ship`,
  { method: "POST", allowFailure: true, body: JSON.stringify(shipmentPayload) },
  admin,
);
if (failed.status < 400)
  throw new Error("Expected the second shared-material line to fail");
const referenceNo = `SALE-SHIP-${order.orderNo}`;
const afterFailureQty = await ledgerQty(admin, material.id, location.id);
const afterFailureOrder = await request(`/orders/${order.id}`, {}, admin);
const failedTransactions = await shipmentTransactions(admin, referenceNo);
if (
  afterFailureQty !== 1 ||
  afterFailureOrder.status !== "DRAFT" ||
  failedTransactions.length !== 0
) {
  throw new Error(
    `Failed shipment was partially committed: ${JSON.stringify({ afterFailureQty, status: afterFailureOrder.status, transactions: failedTransactions.length })}`,
  );
}

await request(
  "/inventory/move",
  {
    method: "POST",
    body: JSON.stringify({
      materialId: material.id,
      quantity: 1,
      destLocationId: location.id,
      batchNo,
      referenceNo: `SHIP-RESTORE-${suffix}`,
    }),
  },
  admin,
);
const shipped = await request(
  `/inventory/posting/sale-order/${order.id}/ship`,
  { method: "POST", body: JSON.stringify(shipmentPayload) },
  admin,
);
const afterSuccessQty = await ledgerQty(admin, material.id, location.id);
const afterSuccessOrder = await request(`/orders/${order.id}`, {}, admin);
const successfulTransactions = await shipmentTransactions(admin, referenceNo);
if (
  shipped.postedLines?.length !== 2 ||
  afterSuccessQty !== 0 ||
  afterSuccessOrder.status !== "SHIPPED" ||
  successfulTransactions.length !== 2
) {
  throw new Error(
    `Successful shipment is incomplete: ${JSON.stringify({ lines: shipped.postedLines?.length, afterSuccessQty, status: afterSuccessOrder.status, transactions: successfulTransactions.length })}`,
  );
}

const firstReversal = await request(
  `/inventory/posting/sale-order/${order.id}/reverse`,
  {
    method: "POST",
    body: JSON.stringify({
      destLocationId: location.id,
      note: "第一周期发货冲销 UAT",
    }),
  },
  admin,
);
const afterFirstReversalQty = await ledgerQty(
  admin,
  material.id,
  location.id,
);
const afterFirstReversalOrder = await request(`/orders/${order.id}`, {}, admin);
if (
  firstReversal.reversedLines?.length !== 2 ||
  !firstReversal.returnDocument?.returnNo ||
  afterFirstReversalQty !== 2 ||
  afterFirstReversalOrder.status !== "IN_PRODUCTION"
) {
  throw new Error(
    `First reversal is incomplete: ${JSON.stringify({ lines: firstReversal.reversedLines?.length, returnNo: firstReversal.returnDocument?.returnNo, qty: afterFirstReversalQty, status: afterFirstReversalOrder.status })}`,
  );
}

const reversalReplay = await request(
  `/inventory/posting/sale-order/${order.id}/reverse`,
  {
    method: "POST",
    body: JSON.stringify({
      destLocationId: location.id,
      note: "第一周期发货冲销重放 UAT",
    }),
  },
  admin,
);
const afterReplayQty = await ledgerQty(admin, material.id, location.id);
if (
  reversalReplay.reversedLines?.length !== 0 ||
  reversalReplay.returnDocument?.id !== firstReversal.returnDocument.id ||
  afterReplayQty !== 2
) {
  throw new Error(
    `Reversal replay was not idempotent: ${JSON.stringify({ lines: reversalReplay.reversedLines?.length, returnId: reversalReplay.returnDocument?.id, qty: afterReplayQty })}`,
  );
}

const reshipped = await request(
  `/inventory/posting/sale-order/${order.id}/ship`,
  { method: "POST", body: JSON.stringify(shipmentPayload) },
  admin,
);
const afterReshipQty = await ledgerQty(admin, material.id, location.id);
const afterReshipOrder = await request(`/orders/${order.id}`, {}, admin);
if (
  reshipped.postedLines?.length !== 2 ||
  afterReshipQty !== 0 ||
  afterReshipOrder.status !== "SHIPPED"
) {
  throw new Error(
    `Reship after reversal failed: ${JSON.stringify({ lines: reshipped.postedLines?.length, qty: afterReshipQty, status: afterReshipOrder.status })}`,
  );
}

const secondReversal = await request(
  `/inventory/posting/sale-order/${order.id}/reverse`,
  {
    method: "POST",
    body: JSON.stringify({
      destLocationId: location.id,
      note: "第二周期发货冲销 UAT",
    }),
  },
  admin,
);
const afterSecondReversalQty = await ledgerQty(
  admin,
  material.id,
  location.id,
);
const afterSecondReversalOrder = await request(
  `/orders/${order.id}`,
  {},
  admin,
);
const reversalTransactions = await transactionsByReferencePrefix(
  admin,
  `SALE-SHIP-REV-${order.orderNo}`,
  "INBOUND",
);
if (
  secondReversal.reversedLines?.length !== 2 ||
  secondReversal.returnDocument?.id === firstReversal.returnDocument.id ||
  afterSecondReversalQty !== 2 ||
  afterSecondReversalOrder.status !== "IN_PRODUCTION" ||
  reversalTransactions.length !== 4
) {
  throw new Error(
    `Second reversal cycle failed: ${JSON.stringify({ lines: secondReversal.reversedLines?.length, returnId: secondReversal.returnDocument?.id, qty: afterSecondReversalQty, status: afterSecondReversalOrder.status, transactions: reversalTransactions.length })}`,
  );
}

console.log(
  JSON.stringify({
    passed: true,
    orderNo: order.orderNo,
    failedShipmentStatus: failed.status,
    stockRolledBack: afterFailureQty === 1,
    orderStatusRolledBack: afterFailureOrder.status === "DRAFT",
    noPartialTransactions: failedTransactions.length === 0,
    successfulShipmentLines: shipped.postedLines.length,
    stockClearedAfterSuccess: afterSuccessQty === 0,
    firstReversalRestoredStock: afterFirstReversalQty === 2,
    reversalReplayIdempotent: afterReplayQty === 2,
    reshipAfterReversalPassed: afterReshipOrder.status === "SHIPPED",
    secondReversalCyclePassed: reversalTransactions.length === 4,
    reversalReturnDocuments: [
      firstReversal.returnDocument.returnNo,
      secondReversal.returnDocument.returnNo,
    ],
    finalOrderStatus: afterSecondReversalOrder.status,
  }),
);

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}
