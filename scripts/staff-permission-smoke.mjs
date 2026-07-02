#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [];
const startedAt = new Date();

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
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
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...parts] = line.split('=');
    env[key.trim()] = parts.join('=').trim().replace(/^"|"$/g, '');
  }
  return env;
}

function addStep(name, passed, detail, data) {
  steps.push({ name, passed, detail, data, checkedAt: new Date().toISOString() });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} - ${detail}`);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function randomSuffix(bytes = 4) {
  return randomBytes(bytes).toString('hex');
}

async function bodyOf(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class Api {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = '';
    this.companyId = '';
  }

  setAuth(token, companyId) {
    this.token = token;
    this.companyId = companyId;
  }

  async request(method, route, body, allowFailure = false) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.companyId) headers['x-company-id'] = this.companyId;
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await bodyOf(response);
    if (!response.ok && !allowFailure) {
      const message =
        data && typeof data === 'object' ? data.message ?? JSON.stringify(data) : data;
      throw new Error(`${method} ${route} failed: ${response.status} ${message}`);
    }
    return { ok: response.ok, status: response.status, data };
  }

  get(route) {
    return this.request('GET', route);
  }

  post(route, body, allowFailure = false) {
    return this.request('POST', route, body, allowFailure);
  }

  put(route, body, allowFailure = false) {
    return this.request('PUT', route, body, allowFailure);
  }
}

async function withStep(name, fn) {
  try {
    const result = await fn();
    addStep(name, true, result?.detail ?? 'ok', result?.data);
    return result?.value;
  } catch (error) {
    addStep(name, false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
const envFile = path.resolve(root, args.envFile ?? process.env.ENV_FILE ?? '.env');
const env = readEnvFile(envFile);
const apiBaseUrl =
  args.apiBaseUrl ||
  process.env.API_BASE_URL ||
  `http://localhost:${env.API_PORT || process.env.API_PORT || '8000'}/api`;
const email = args.email || process.env.INIT_ADMIN_EMAIL || env.INIT_ADMIN_EMAIL;
const password =
  args.password || process.env.INIT_ADMIN_PASSWORD || env.INIT_ADMIN_PASSWORD;
const reportPath = path.resolve(
  root,
  args.report || process.env.STAFF_PERMISSION_SMOKE_REPORT || 'staff-permission-smoke-report.json',
);

let exitCode = 0;
let context = {};

try {
  const adminApi = new Api(apiBaseUrl);
  const suffix = `${Date.now().toString(36)}-${randomSuffix(3)}`;
  context = { apiBaseUrl, suffix };

  await withStep('admin-login', async () => {
    const login = await adminApi.post('/auth/login', { email, password });
    const companyId = login.data?.companies?.[0]?.id;
    assertCondition(login.data?.accessToken && companyId, '管理员登录未返回 token/company');
    adminApi.setAuth(login.data.accessToken, companyId);
    context.companyId = companyId;
    return { detail: `company=${companyId}` };
  });

  const roles = await withStep('load-roles', async () => {
    const response = await adminApi.get('/users/roles');
    const loaded = Array.isArray(response.data) ? response.data : [];
    const readonly = loaded.find((role) => role.name === 'Readonly');
    assertCondition(readonly?.id, '缺少 Readonly 角色');
    return { detail: `roles=${loaded.length}`, value: { loaded, readonly } };
  });

  const employeePassword = `Staff-${suffix}-Pwd1`;
  const employeeEmail = `staff-${suffix}@oneerp.local`;
  await withStep('create-readonly-employee', async () => {
    const created = await adminApi.post('/users', {
      name: `权限验收员工 ${suffix}`,
      email: employeeEmail,
      password: employeePassword,
      roleId: roles.readonly.id,
      isActive: true,
    });
    assertCondition(created.data?.id, '员工创建未返回 id');
    context.employeeId = created.data.id;
    return { detail: `employee=${employeeEmail}` };
  });

  const invitePassword = `Invite-${suffix}-Pwd1`;
  await withStep('create-and-accept-invitation', async () => {
    const inviteEmail = `invite-${suffix}@oneerp.local`;
    const invitation = await adminApi.post('/users/invitations', {
      name: `邀请员工 ${suffix}`,
      email: inviteEmail,
      roleId: roles.readonly.id,
      expiresInHours: 24,
    });
    const token = invitation.data?.token;
    assertCondition(token, '邀请未返回一次性 token');
    const accepted = await adminApi.post('/auth/accept-invite', {
      token,
      password: invitePassword,
    });
    assertCondition(accepted.data?.accessToken, '接受邀请后未返回 token');
    return { detail: `invite=${inviteEmail}` };
  });

  const employeeApi = new Api(apiBaseUrl);
  await withStep('employee-login', async () => {
    const login = await employeeApi.post('/auth/login', {
      email: employeeEmail,
      password: employeePassword,
    });
    const companyId = login.data?.companies?.[0]?.id;
    employeeApi.setAuth(login.data?.accessToken, companyId);
    assertCondition(employeeApi.token && employeeApi.companyId, '员工登录失败');
    return { detail: `company=${companyId}` };
  });

  await withStep('employee-read-allowed', async () => {
    const orders = await employeeApi.get('/orders');
    assertCondition(orders.status === 200, '员工只读订单接口失败');
    return { detail: 'GET /orders allowed' };
  });

  await withStep('employee-user-create-denied', async () => {
    const denied = await employeeApi.post(
      '/users',
      {
        name: 'Denied',
        email: `denied-${suffix}@oneerp.local`,
        password: 'Denied-Password1',
        roleId: roles.readonly.id,
      },
      true,
    );
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'POST /users denied' };
  });

  await withStep('employee-inventory-post-denied', async () => {
    const denied = await employeeApi.post(
      '/inventory/posting/purchase/inbound',
      {
        purchaseNo: `DENIED-${suffix}`,
        materialId: 'not-real',
        quantity: 1,
      },
      true,
    );
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'inventory post denied' };
  });

  await withStep('employee-workflow-transition-denied', async () => {
    const denied = await employeeApi.post(
      `/v1/workflow/order/not-real/transition`,
      { action: 'submit' },
      true,
    );
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'workflow transition denied' };
  });

  await withStep('employee-department-create-denied', async () => {
    const denied = await employeeApi.post(
      '/departments',
      { name: `Denied Dept ${suffix}` },
      true,
    );
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'department create denied' };
  });

  await withStep('employee-file-upload-denied', async () => {
    const denied = await employeeApi.post('/files/upload', undefined, true);
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'file upload denied' };
  });

  await withStep('employee-ai-read-allowed', async () => {
    const tools = await employeeApi.get('/v1/ai/tools');
    assertCondition(tools.status === 200, '员工 AI 只读 tools 接口失败');
    return { detail: 'GET /v1/ai/tools allowed' };
  });

  await withStep('employee-ai-write-denied', async () => {
    const denied = await employeeApi.post(
      '/v1/ai/command',
      {
        input: 'create customer',
        dryRun: false,
        overrideTool: {
          toolName: 'create_resource',
          args: { modelName: 'partner', data: { name: 'Denied' } },
        },
      },
      true,
    );
    assertCondition(denied.status === 403, `期望 403，实际 ${denied.status}`);
    return { detail: 'AI write denied' };
  });
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  const endedAt = new Date();
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10,
        passed: steps.every((step) => step.passed),
        context,
        steps,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Report: ${reportPath}`);
}

process.exit(exitCode);
