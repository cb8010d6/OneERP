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
    revision: `R${String(releasedRevision.revisionNo).padStart(2, '0')}`,
    status: releasedRevision.status,
    checksumVerified: true,
    linkedProductId: released.product?.id ?? null,
    linkedOrderId: released.order?.id ?? null,
    workOrderNo: pinnedWorkOrder.workOrderNo,
    pinnedRevisionVerified: true,
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
