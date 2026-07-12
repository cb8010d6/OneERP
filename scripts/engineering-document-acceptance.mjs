import crypto from 'node:crypto';
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
if (!productId || !orderId) {
  throw new Error('--product-id and --order-id are required');
}

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
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function expectFailure(path, expectedStatus, options = {}, session = {}) {
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
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(
      `${options.method ?? 'GET'} ${path} expected ${expectedStatus}, got ${response.status}: ${body}`,
    );
  }
}

async function login(email, password) {
  const body = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const companyId = body.companies?.[0]?.id;
  if (!body.accessToken || !companyId) throw new Error(`Login failed for ${email}`);
  return { token: body.accessToken, companyId };
}

async function upload(session, name, content) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([content], { type: 'application/pdf' }),
    name,
  );
  const response = await fetch(`${apiBaseUrl}/files/upload?folder=engineering`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'x-company-id': session.companyId,
    },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${JSON.stringify(body)}`);
  }
  if (!body.id || !body.checksumSha256) throw new Error('Upload did not return checksum');
  return body;
}

const admin = await login(adminEmail, adminPassword);
const roles = await request('/users/roles', {}, admin);
const roleId = (name) => roles.find((role) => role.name === name)?.id;
const requiredRoles = ['EngineeringDesign', 'EngineeringReview', 'EngineeringApprover'];
for (const name of requiredRoles) {
  if (!roleId(name)) throw new Error(`Missing role template: ${name}`);
}

const suffix = Date.now();
const temporaryPassword = `Eng!${crypto.randomBytes(12).toString('hex')}Aa1`;
const createUser = async (roleName, label) => {
  const email = `uat-engineering-${label}-${suffix}@example.test`;
  const created = await request(
    '/users',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: temporaryPassword,
        name: `UAT ${roleName}`,
        roleId: roleId(roleName),
      }),
    },
    admin,
  );
  return { userId: created.id, ...(await login(email, temporaryPassword)) };
};

const designer = await createUser('EngineeringDesign', 'design');
const reviewer = await createUser('EngineeringReview', 'review');
const approver = await createUser('EngineeringApprover', 'approve');

const file = await upload(
  designer,
  `engineering-${suffix}.pdf`,
  `%PDF-1.4\nControlled engineering drawing ${suffix}\n%%EOF\n`,
);
const document = await request(
  '/engineering-documents',
  {
    method: 'POST',
    body: JSON.stringify({
      title: `UAT 总装图 ${suffix}`,
      documentType: 'DRAWING',
      externalNo: `CUSTOMER-${suffix}`,
      productId,
      orderId,
      fileRecordId: file.id,
      notes: '首版工程图纸 UAT',
    }),
  },
  designer,
);
const revision = document.revisions?.[0];
if (!revision || revision.status !== 'DRAFT') throw new Error('Draft revision was not created');

const submitted = await request(
  `/engineering-documents/revisions/${revision.id}/submit`,
  { method: 'POST', body: '{}' },
  designer,
);
if (submitted.status !== 'PENDING_REVIEW') throw new Error('Revision was not submitted');

const reviewed = await request(
  `/engineering-documents/revisions/${revision.id}/review`,
  {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVE', comment: '尺寸、材料和图框符合要求' }),
  },
  reviewer,
);
if (reviewed.status !== 'PENDING_APPROVAL') throw new Error('Revision was not reviewed');

await request(
  `/engineering-documents/revisions/${revision.id}/release`,
  { method: 'POST', body: '{}' },
  approver,
);
const documents = await request('/engineering-documents', {}, designer);
const released = documents.find((item) => item.id === document.id);
const releasedRevision = released?.revisions?.find((item) => item.id === revision.id);
if (
  !released ||
  released.currentReleasedRevisionId !== revision.id ||
  releasedRevision?.status !== 'RELEASED' ||
  releasedRevision.checksumSha256 !== file.checksumSha256
) {
  throw new Error('Released revision did not retain the uploaded checksum and identity');
}

const workOrder = await request(
  '/production/orders',
  {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      productId,
      plannedQty: 1,
      engineeringRevisionIds: [revision.id],
    }),
  },
  admin,
);
const workOrders = await request('/production/orders?page=1&limit=100', {}, admin);
const pinnedWorkOrder = workOrders.data?.find((item) => item.id === workOrder.id);
if (
  !pinnedWorkOrder?.engineeringRevisionPins?.some(
    (pin) => pin.engineeringRevision?.id === revision.id,
  )
) {
  throw new Error('Work order did not retain the released engineering revision');
}

const secondFile = await upload(
  designer,
  `engineering-${suffix}-r02.pdf`,
  `%PDF-1.4\nControlled engineering drawing R02 ${suffix}\n%%EOF\n`,
);
const secondRevision = await request(
  `/engineering-documents/${document.id}/revisions`,
  {
    method: 'POST',
    body: JSON.stringify({
      fileRecordId: secondFile.id,
      notes: '客户尺寸变更 R02',
    }),
  },
  designer,
);
await request(
  `/engineering-documents/revisions/${secondRevision.id}/submit`,
  { method: 'POST', body: '{}' },
  designer,
);
await request(
  `/engineering-documents/revisions/${secondRevision.id}/review`,
  {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVE', comment: 'R02 校审通过' }),
  },
  reviewer,
);
await expectFailure(
  `/engineering-documents/revisions/${secondRevision.id}/release`,
  409,
  { method: 'POST', body: '{}' },
  approver,
);

const ecoPreview = await request(
  `/engineering-change-orders/preview/${document.id}/${secondRevision.id}`,
  {},
  designer,
);
if (!ecoPreview.affectedWorkOrders?.some((item) => item.id === workOrder.id)) {
  throw new Error('ECO preview did not include the affected work order');
}
const eco = await request(
  `/engineering-change-orders/${document.id}`,
  {
    method: 'POST',
    body: JSON.stringify({
      targetRevisionId: secondRevision.id,
      reason: '客户确认尺寸变更',
      impactAssessment: `在制工单 ${pinnedWorkOrder.workOrderNo} 需要切换 R02`,
      materialDisposition: '旧版物料隔离，新版复核后继续生产',
      impacts: [{ workOrderId: workOrder.id, decision: 'SWITCH_NEW' }],
    }),
  },
  designer,
);
await request(
  `/engineering-change-orders/${eco.id}/submit`,
  { method: 'POST', body: '{}' },
  designer,
);
await request(
  `/engineering-change-orders/${eco.id}/decision`,
  { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', comment: '影响评估完整' }) },
  approver,
);

const changedDocuments = await request('/engineering-documents', {}, designer);
const changedDocument = changedDocuments.find((item) => item.id === document.id);
const oldRevisionAfterEco = changedDocument?.revisions?.find((item) => item.id === revision.id);
const newRevisionAfterEco = changedDocument?.revisions?.find(
  (item) => item.id === secondRevision.id,
);
const changedWorkOrders = await request('/production/orders?page=1&limit=100', {}, admin);
const changedWorkOrder = changedWorkOrders.data?.find((item) => item.id === workOrder.id);
if (
  changedDocument?.currentReleasedRevisionId !== secondRevision.id ||
  oldRevisionAfterEco?.status !== 'OBSOLETE' ||
  newRevisionAfterEco?.status !== 'RELEASED' ||
  !changedWorkOrder?.engineeringRevisionPins?.some(
    (pin) => pin.engineeringRevision?.id === secondRevision.id,
  )
) {
  throw new Error('Approved ECO did not release R02 and switch the affected work order');
}

for (const actor of [designer, reviewer, approver]) {
  await request(
    `/users/${actor.userId}/toggle-active`,
    { method: 'PUT', body: '{}' },
    admin,
  );
}

console.log(
  JSON.stringify({
    passed: true,
    documentNo: released.documentNo,
    revision: `R${String(newRevisionAfterEco.revisionNo).padStart(2, '0')}`,
    status: newRevisionAfterEco.status,
    checksumVerified: true,
    linkedProductId: released.product?.id ?? null,
    linkedOrderId: released.order?.id ?? null,
    workOrderNo: pinnedWorkOrder.workOrderNo,
    pinnedRevisionVerified: true,
    directReleaseBlocked: true,
    ecoNo: eco.ecoNo,
    ecoApplied: true,
    actorsDistinct: true,
    temporaryUsersDisabled: true,
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
