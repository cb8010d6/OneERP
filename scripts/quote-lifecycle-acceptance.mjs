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
    items: [{ productId, quantity: 2, unitPrice: 125, taxRate: 0 }],
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
    versionStatus: contractV1.status,
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
