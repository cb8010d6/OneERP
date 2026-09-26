import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  ApiClient,
  asNumber,
  isLoopbackHostname,
  loadConfig,
  normalizeApiBaseUrl,
  parseArgs,
} from './stocked-trade-acceptance.mjs';

const completeEnv = {
  STOCKED_TRADE_ACCEPTANCE: '1',
  API_BASE_URL: 'http://127.0.0.1:8000/api',
  BUSINESS_ACCEPTANCE_ADMIN_EMAIL: 'uat@example.test',
  BUSINESS_ACCEPTANCE_ADMIN_PASSWORD: 'synthetic-password',
  BUSINESS_ACCEPTANCE_COMPANY_NAME: 'Synthetic UAT Company',
};

test('requires explicit opt-in and every synthetic-tenant input', () => {
  const disabled = { ...completeEnv, STOCKED_TRADE_ACCEPTANCE: undefined };
  assert.throws(() => loadConfig(disabled, []), /STOCKED_TRADE_ACCEPTANCE=1/);

  for (const key of [
    'API_BASE_URL',
    'BUSINESS_ACCEPTANCE_ADMIN_EMAIL',
    'BUSINESS_ACCEPTANCE_ADMIN_PASSWORD',
    'BUSINESS_ACCEPTANCE_COMPANY_NAME',
  ]) {
    const missing = { ...completeEnv, [key]: '' };
    assert.throws(() => loadConfig(missing, []), new RegExp(`${key} is required`));
  }
});

test('limits API targets to explicit loopback URLs and normalizes the API prefix', () => {
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1:8000'), 'http://127.0.0.1:8000/api');
  assert.equal(normalizeApiBaseUrl('http://localhost:8000/api/'), 'http://localhost:8000/api');
  assert.equal(normalizeApiBaseUrl('http://[::1]:8000/api'), 'http://[::1]:8000/api');
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.throws(() => normalizeApiBaseUrl('https://oneerp.example/api'), /must target localhost/);
  assert.throws(() => normalizeApiBaseUrl('http://127.0.0.1:8000/api?redirect=elsewhere'), /cannot contain/);
  assert.throws(() => normalizeApiBaseUrl('http://user:pass@127.0.0.1:8000/api'), /cannot contain/);
  assert.throws(() => normalizeApiBaseUrl('http://127.0.0.1:8000/admin'), /path must be/);
});

test('accepts only the report CLI option and validates quantities without coercing missing values to zero', () => {
  assert.deepEqual(parseArgs(['--report', 'out.json']), { report: 'out.json' });
  assert.deepEqual(parseArgs(['--report=out.json']), { report: 'out.json' });
  assert.throws(() => parseArgs(['--api-base-url', 'http://127.0.0.1']), /Unknown argument/);
  assert.equal(asNumber('4', 'quantity'), 4);
  for (const value of [null, undefined, '']) {
    assert.throws(() => asNumber(value, 'quantity'), /was missing/);
  }
});

test('request deadline covers a stalled response body after headers arrive', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.flushHeaders();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new ApiClient(`http://127.0.0.1:${address.port}/api`, 100);

  const startedAt = Date.now();
  try {
    await assert.rejects(client.get('/slow-body'), /failed or timed out after 100 ms/);
    assert.ok(Date.now() - startedAt < 2_000, 'stalled response exceeded the bounded deadline');
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('HTTP failures expose status without copying response bodies into the error', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'sensitive server detail' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const client = new ApiClient(`http://127.0.0.1:${address.port}/api`, 1_000);

  try {
    await assert.rejects(client.get('/forbidden'), (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /sensitive server detail/);
      return true;
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
