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

const admin = await login(adminEmail, adminPassword);
const suffix = Date.now().toString(36).toUpperCase();
const purchaseNo = `ATOMIC-PO-${suffix}`;
const warehouse = await createResource(admin, "warehouse", {
  name: `原子冲销验收仓 ${suffix}`,
  type: "MATERIAL",
});
const location = await createResource(admin, "stockLocation", {
  name: `原子冲销库位 ${suffix}`,
  code: `ATOMIC-${suffix}`,
  usage: "INTERNAL",
  isActive: true,
  warehouseId: warehouse.id,
});
const firstMaterial = await createResource(admin, "material", {
  sku: `ATOMIC-A-${suffix}`,
  name: `原子冲销物料 A ${suffix}`,
  category: "UAT",
  unit: "pcs",
  minStock: 0,
  unitPrice: 5,
});
const secondMaterial = await createResource(admin, "material", {
  sku: `ATOMIC-B-${suffix}`,
  name: `原子冲销物料 B ${suffix}`,
  category: "UAT",
  unit: "pcs",
  minStock: 0,
  unitPrice: 7,
});

for (const [material, quantity] of [
  [firstMaterial, 2],
  [secondMaterial, 1],
]) {
  await request(
    "/inventory/posting/purchase/inbound",
    {
      method: "POST",
      body: JSON.stringify({
        purchaseNo,
        materialId: material.id,
        quantity,
        destLocationId: location.id,
        batchNo: `BATCH-${material.sku}`,
      }),
    },
    admin,
  );
}

await request(
  "/inventory/move",
  {
    method: "POST",
    body: JSON.stringify({
      materialId: secondMaterial.id,
      quantity: 1,
      sourceLocationId: location.id,
      batchNo: `BATCH-${secondMaterial.sku}`,
      referenceNo: `ATOMIC-CONSUME-${suffix}`,
    }),
  },
  admin,
);

const failedReverse = await request(
  `/inventory/posting/purchase/${purchaseNo}/reverse`,
  {
    method: "POST",
    allowFailure: true,
    body: JSON.stringify({ note: "验证整单失败回滚" }),
  },
  admin,
);
if (failedReverse.status < 400)
  throw new Error(
    "Expected reversal to fail when the second material has no stock",
  );

const afterFailure = {
  first: await ledgerQty(admin, firstMaterial.id, location.id),
  second: await ledgerQty(admin, secondMaterial.id, location.id),
};
if (afterFailure.first !== 2 || afterFailure.second !== 0) {
  throw new Error(
    `Failed reversal left partial stock changes: ${JSON.stringify(afterFailure)}`,
  );
}

await request(
  "/inventory/move",
  {
    method: "POST",
    body: JSON.stringify({
      materialId: secondMaterial.id,
      quantity: 1,
      destLocationId: location.id,
      batchNo: `BATCH-${secondMaterial.sku}`,
      referenceNo: `ATOMIC-RESTORE-${suffix}`,
    }),
  },
  admin,
);

const reversed = await request(
  `/inventory/posting/purchase/${purchaseNo}/reverse`,
  { method: "POST", body: JSON.stringify({ note: "验证整单原子冲销" }) },
  admin,
);
if (reversed.reversedLines?.length !== 2 || !reversed.returnDocument?.id) {
  throw new Error(
    `Successful reversal is incomplete: ${JSON.stringify(reversed)}`,
  );
}

const afterSuccess = {
  first: await ledgerQty(admin, firstMaterial.id, location.id),
  second: await ledgerQty(admin, secondMaterial.id, location.id),
};
if (afterSuccess.first !== 0 || afterSuccess.second !== 0) {
  throw new Error(
    `Successful reversal left unexpected stock: ${JSON.stringify(afterSuccess)}`,
  );
}

const replay = await request(
  `/inventory/posting/purchase/${purchaseNo}/reverse`,
  { method: "POST", body: JSON.stringify({ note: "重复冲销应安全跳过" }) },
  admin,
);
if (replay.reversedLines?.length !== 0 || !replay.returnDocument?.id) {
  throw new Error(
    `Reversal replay was not idempotent: ${JSON.stringify(replay)}`,
  );
}

console.log(
  JSON.stringify({
    passed: true,
    purchaseNo,
    failedReverseStatus: failedReverse.status,
    firstLineRolledBack: afterFailure.first === 2,
    secondLineStayedEmpty: afterFailure.second === 0,
    successfulReversalLines: reversed.reversedLines.length,
    stockClearedAfterSuccess:
      afterSuccess.first === 0 && afterSuccess.second === 0,
    idempotentReplay: replay.reversedLines.length === 0,
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
