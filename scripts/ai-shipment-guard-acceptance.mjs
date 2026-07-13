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

const session = { token: login.body.accessToken, companyId };
const tools = await request("/v1/ai/tools", {}, session);
const transitionTool = tools.body?.tools?.find(
  (tool) => tool.name === "transition_workflow",
);
const transitionProperties = transitionTool?.parameters?.properties;
const allowedModels = transitionProperties?.modelName?.enum ?? [];
const allowedActions = transitionProperties?.action?.enum ?? [];
if (
  tools.status !== 200 ||
  JSON.stringify(allowedModels) !== JSON.stringify(["order"]) ||
  JSON.stringify(allowedActions) !==
    JSON.stringify(["submit", "start_production", "complete"])
) {
  throw new Error("AI workflow tool schema does not match the safety whitelist");
}

const guardCases = [
  {
    name: "shipment",
    input: "发货订单 ORD-UAT-AI-GUARD",
    args: { modelName: "order", recordId: "order-guard", action: "ship" },
    expected: "销售发货工作台",
  },
  {
    name: "work-order-complete",
    input: "完成生产工单",
    args: {
      modelName: "workOrder",
      recordId: "work-order-guard",
      action: "complete",
    },
    expected: "生产报工工作台",
  },
  {
    name: "invoice-post",
    input: "过账发票",
    args: { modelName: "invoice", recordId: "invoice-guard", action: "post" },
    expected: "财务工作台",
  },
  {
    name: "order-cancel",
    input: "取消订单",
    args: { modelName: "order", recordId: "order-guard", action: "cancel" },
    expected: "AI 安全白名单",
  },
];

for (const guardCase of guardCases) {
  const result = await request(
    "/v1/ai/command",
    {
      method: "POST",
      body: JSON.stringify({
        input: guardCase.input,
        dryRun: true,
        overrideTool: {
          toolName: "transition_workflow",
          args: guardCase.args,
        },
      }),
    },
    session,
  );
  const message = Array.isArray(result.body?.message)
    ? result.body.message.join(" ")
    : String(result.body?.message ?? "");
  if (result.status !== 400 || !message.includes(guardCase.expected)) {
    throw new Error(
      `${guardCase.name} guard failed (${result.status}): ${message}`,
    );
  }
}

console.log(
  JSON.stringify({
    passed: true,
    schemaWhitelistVerified: true,
    shipmentDraftBlocked: true,
    workOrderCompletionBlocked: true,
    invoicePostingBlocked: true,
    orderCancellationBlocked: true,
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
