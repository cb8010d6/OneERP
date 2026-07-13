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
if (!adminEmail || !adminPassword) {
  throw new Error("INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD are required");
}

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
  return { status: response.status, body };
}

const login = await request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
const companyId = login.body?.companies?.[0]?.id;
if (login.status !== 200 || !login.body?.accessToken || !companyId) {
  throw new Error(`Admin login failed (${login.status})`);
}

const result = await request(
  "/v1/ai/command",
  {
    method: "POST",
    body: JSON.stringify({
      input: "发货订单 ORD-UAT-AI-GUARD",
      dryRun: true,
    }),
  },
  { token: login.body.accessToken, companyId },
);

const message = Array.isArray(result.body?.message)
  ? result.body.message.join(" ")
  : String(result.body?.message ?? "");
if (result.status !== 400) {
  throw new Error(`Expected AI shipment guard status 400, got ${result.status}`);
}
if (!message.includes("销售发货工作台")) {
  throw new Error(`AI shipment guard message is missing: ${message}`);
}

console.log(
  JSON.stringify({
    passed: true,
    status: result.status,
    shipmentDraftBlocked: true,
    workflowGuidanceVerified: true,
  }),
);

function parseEnv(content) {
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}
