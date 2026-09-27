import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, login, uploadDrawing } from './manufacturing-acceptance.mjs';

const env = {
  MANUFACTURING_ACCEPTANCE: '1', API_BASE_URL: 'http://127.0.0.1:8000/api',
  BUSINESS_ACCEPTANCE_COMPANY_NAME: 'OneERP Synthetic HTTP Journey test',
  BUSINESS_ACCEPTANCE_ADMIN_EMAIL: 'fixture@example.test',
  BUSINESS_ACCEPTANCE_ADMIN_PASSWORD: 'never-print-this-password',
};

test('requires explicit opt-in, loopback target, synthetic company, credentials and bounded timeout', () => {
  for (const changed of [
    { MANUFACTURING_ACCEPTANCE: undefined }, { MANUFACTURING_ACCEPTANCE: 'true' },
    { API_BASE_URL: undefined }, { API_BASE_URL: 'https://production.example/api' },
    { API_BASE_URL: 'http://127.0.0.1.evil.test/api' },
    { API_BASE_URL: 'http://user:password@127.0.0.1/api' },
    { API_BASE_URL: 'http://localhost/api?token=secret' },
    { API_BASE_URL: 'http://localhost/admin' },
    { BUSINESS_ACCEPTANCE_COMPANY_NAME: 'Production' },
    { BUSINESS_ACCEPTANCE_COMPANY_NAME: undefined },
    { BUSINESS_ACCEPTANCE_ADMIN_EMAIL: '' }, { BUSINESS_ACCEPTANCE_ADMIN_PASSWORD: '' },
    { MANUFACTURING_HTTP_TIMEOUT_MS: '0' }, { MANUFACTURING_HTTP_TIMEOUT_MS: '120001' },
  ]) assert.throws(() => loadConfig({ ...env, ...changed }, []));
  assert.throws(() => loadConfig(env, ['--product-id', 'existing-record']));
  assert.equal(loadConfig(env, ['--report', '/tmp/mfg.json']).reportPath, '/tmp/mfg.json');
});

test('login fails closed for missing or ambiguous selected company before any write', async (t) => {
  for (const companies of [[], [{ id: 'other', name: 'Other' }], [
    { id: 'one', name: env.BUSINESS_ACCEPTANCE_COMPANY_NAME },
    { id: 'two', name: env.BUSINESS_ACCEPTANCE_COMPANY_NAME },
  ]]) {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ accessToken: 'secret-token', companies }), { status: 200 });
    });
    await assert.rejects(login(loadConfig(env, [])), /exactly one/);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.endsWith('/auth/login'));
    assert.equal(requests[0].options.redirect, 'error');
    t.mock.restoreAll();
  }
});

test('upload rejects redirects, carries a bounded abort signal, and redacts server errors', async (t) => {
  let options;
  t.mock.method(globalThis, 'fetch', async (_url, requestOptions) => {
    options = requestOptions;
    return new Response(JSON.stringify({ error: 'secret-token server detail' }), { status: 500 });
  });
  await assert.rejects(uploadDrawing({ baseUrl: 'http://localhost/api', timeoutMs: 250,
    accessToken: 'secret-token', companyId: 'synthetic' }, 'MFG-test'), (error) => {
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /secret-token|server detail/);
    return true;
  });
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers['x-company-id'], 'synthetic');
});
