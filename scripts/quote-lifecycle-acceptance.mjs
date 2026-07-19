import fs from 'node:fs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key?.startsWith('--')) args.set(key.slice(2), process.argv[index + 1]);
}

const envPath = args.get('env-file') ?? '.env';
const apiBaseUrl = (args.get('api-base-url') ?? 'http://127.0.0.1:18000/api').replace(/\/$/, '');
const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
const email = process.env.INIT_ADMIN_EMAIL ?? env.INIT_ADMIN_EMAIL;
const password = process.env.INIT_ADMIN_PASSWORD ?? env.INIT_ADMIN_PASSWORD;
if (!email || !password) throw new Error('INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD are required');

let token = '';
let companyId = '';

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(companyId ? { 'x-company-id': companyId } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function uploadSignedPdf(contractNo) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([`%PDF-1.4\nSigned contract ${contractNo}\n%%EOF\n`], {
      type: 'application/pdf',
    }),
    `${contractNo}-signed.pdf`,
  );
  const response = await fetch(`${apiBaseUrl}/files/upload?folder=contracts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-company-id': companyId,
    },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`signed PDF upload failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function requestExpectFailure(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-company-id': companyId,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} unexpectedly succeeded`);
  }
  return { status: response.status, body };
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
token = login.accessToken;
companyId = login.companies?.[0]?.id;
if (!token || !companyId) throw new Error('Login did not return token and company');

const partnerId = args.get('partner-id');
const productId = args.get('product-id');
if (!partnerId || !productId) throw new Error('--partner-id and --product-id are required');
const unitPrice = Number(args.get('unit-price') ?? 50000);
if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('--unit-price must be non-negative');

const suffix = Date.now();
const requirement = await request('/presales/requirements', {
  method: 'POST',
  body: JSON.stringify({
    partnerId,
    sourceChannel: 'quote-lifecycle-acceptance',
    summary: `报价版本生命周期验收 ${suffix}`,
    expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString(),
  }),
});

const quote = await request(`/presales/requirements/${requirement.id}/quotes`, {
  method: 'POST',
  body: JSON.stringify({
    currencyCode: 'CNY',
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
    items: [{ productId, quantity: 2, unitPrice, taxRate: 0 }],
  }),
});
const v1 = quote.versions?.[0];
if (!v1 || v1.status !== 'DRAFT') throw new Error('V1 was not created as DRAFT');

const sentV1 = await request(`/presales/quotes/versions/${v1.id}/send`, { method: 'POST', body: '{}' });
if (sentV1?.status !== 'SENT') throw new Error('V1 was not SENT');

const v2 = await request(`/presales/quotes/${quote.id}/versions`, {
  method: 'POST',
  body: JSON.stringify({}),
});
if (v2?.versionNo !== 2 || v2?.status !== 'DRAFT') throw new Error('V2 was not copied as DRAFT');

const sentV2 = await request(`/presales/quotes/versions/${v2.id}/send`, { method: 'POST', body: '{}' });
if (sentV2?.status !== 'SENT') throw new Error('V2 was not SENT');

const accepted = await request(`/presales/quotes/versions/${v2.id}/decision`, {
  method: 'POST',
  body: JSON.stringify({ status: 'ACCEPTED' }),
});
if (accepted?.status !== 'ACCEPTED') throw new Error('V2 was not ACCEPTED');

const contract = await request(`/presales/contracts/from-quote-version/${v2.id}`, {
  method: 'POST',
  body: JSON.stringify({
    title: `${quote.quoteNo} 销售合同`,
    effectiveAt: new Date().toISOString().slice(0, 10),
  }),
});
const contractV1 = contract?.versions?.[0];
if (!/^CT-\d{4}-\d{6}$/.test(contract?.contractNo ?? '')) {
  throw new Error('Contract number does not match CT-YYYY-######');
}
if (contract?.quoteVersionId !== v2.id || contract?.status !== 'DRAFT') {
  throw new Error('Contract was not created as DRAFT from accepted V2');
}
if (contractV1?.versionNo !== 1 || contractV1?.status !== 'DRAFT') {
  throw new Error('Contract V1 was not created as DRAFT');
}
if (String(contractV1?.total) !== String(accepted.total)) {
  throw new Error('Contract total does not match accepted quote total');
}

const submitted = await request(`/presales/contracts/${contract.id}/submit`, {
  method: 'POST',
  body: '{}',
});
if (submitted?.status !== 'PENDING_SALES_MANAGER') {
  throw new Error('Contract was not submitted to sales manager');
}
const salesApproved = await request(`/presales/contracts/${contract.id}/sales-manager/decision`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'APPROVE', comment: '自动验收：销售主管通过' }),
});
if (salesApproved?.status !== 'PENDING_FINANCE_REVIEW') {
  throw new Error('Threshold contract did not enter finance review');
}
const financeApproved = await request(`/presales/contracts/${contract.id}/finance/decision`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'APPROVE', comment: '自动验收：财务通过' }),
});
if (financeApproved?.status !== 'PENDING_BUSINESS_REVIEW') {
  throw new Error('Threshold contract did not enter business review');
}
const businessApproved = await request(`/presales/contracts/${contract.id}/business/decision`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'APPROVE', comment: '自动验收：商务通过' }),
});
if (businessApproved?.status !== 'APPROVED') {
  throw new Error('Contract did not reach APPROVED');
}
const signedFile = await uploadSignedPdf(contract.contractNo);
if (!signedFile?.id) throw new Error('Signed PDF upload did not return file id');
const signed = await request(`/presales/contracts/${contract.id}/sign`, {
  method: 'POST',
  body: JSON.stringify({ fileRecordId: signedFile.id }),
});
if (signed?.status !== 'SIGNED' || signed?.signedFileId !== signedFile.id) {
  throw new Error('Contract did not bind the signed PDF');
}
const activated = await request(`/presales/contracts/${contract.id}/activate`, {
  method: 'POST',
  body: '{}',
});
if (activated?.status !== 'ACTIVE') {
  throw new Error('Signed contract did not reach ACTIVE');
}
const sourceItemId = accepted?.items?.[0]?.id;
if (!sourceItemId) throw new Error('Accepted quote did not return source item id');
const firstBatchPayload = {
  sourceBatchKey: `${contract.contractNo}-BATCH-01`,
  items: [{ quoteVersionItemId: sourceItemId, quantity: 1 }],
};
const firstBatch = await request(`/presales/contracts/${contract.id}/order-batches`, {
  method: 'POST',
  body: JSON.stringify(firstBatchPayload),
});
if (firstBatch?.idempotentReplay || !firstBatch?.order?.id) {
  throw new Error('First contract order batch was not created');
}
const replayedBatch = await request(`/presales/contracts/${contract.id}/order-batches`, {
  method: 'POST',
  body: JSON.stringify(firstBatchPayload),
});
if (
  replayedBatch?.idempotentReplay !== true ||
  replayedBatch?.order?.id !== firstBatch.order.id
) {
  throw new Error('Repeated sourceBatchKey did not return the original order');
}
const secondBatch = await request(`/presales/contracts/${contract.id}/order-batches`, {
  method: 'POST',
  body: JSON.stringify({
    sourceBatchKey: `${contract.contractNo}-BATCH-02`,
    items: [{ quoteVersionItemId: sourceItemId, quantity: 1 }],
  }),
});
if (!secondBatch?.order?.id || secondBatch.order.id === firstBatch.order.id) {
  throw new Error('Second contract order batch was not created independently');
}
const overAllocated = await requestExpectFailure(
  `/presales/contracts/${contract.id}/order-batches`,
  {
    method: 'POST',
    body: JSON.stringify({
      sourceBatchKey: `${contract.contractNo}-BATCH-03`,
      items: [{ quoteVersionItemId: sourceItemId, quantity: 1 }],
    }),
  },
);
if (overAllocated.status !== 400) {
  throw new Error(`Over-allocation returned ${overAllocated.status}, expected 400`);
}

console.log(JSON.stringify({
  passed: true,
  requirementNo: requirement.requirementNo,
  quoteNo: quote.quoteNo,
  v1: { id: v1.id, status: sentV1.status },
  v2: { id: v2.id, status: accepted.status },
  contract: {
    contractNo: contract.contractNo,
    status: contract.status,
    versionNo: contractV1.versionNo,
    versionStatus: 'ACTIVE',
    signedFileId: signedFile.id,
    orderBatches: [
      firstBatch.order.orderNo,
      secondBatch.order.orderNo,
    ],
    idempotentReplay: replayedBatch.idempotentReplay,
    overAllocationStatus: overAllocated.status,
    approvalPath: [
      submitted.status,
      salesApproved.status,
      financeApproved.status,
      businessApproved.status,
      signed.status,
      activated.status,
    ],
  },
  total: String(accepted.total),
}));

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
      }),
  );
}
