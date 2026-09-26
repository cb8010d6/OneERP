import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ApiClient,
  asNumber,
  assertStockMovementUnchanged,
  isLoopbackHostname,
  loadConfig,
  normalizeApiBaseUrl,
  parseArgs,
  snapshotStockMovement,
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

const originalMovement = {
  id: 'shipment',
  type: 'OUTBOUND',
  referenceNo: 'SALE-SHIP-SO1',
  materialId: 'material',
  quantity: '6.0000',
  sourceLocationId: 'location',
  destLocationId: null,
  batchNo: 'batch',
};

test('movement snapshots preserve numeric meaning and require traceable IDs', () => {
  const snapshot = snapshotStockMovement(originalMovement, 'Shipment');
  assert.equal(snapshot.quantity, 6);
  assertStockMovementUnchanged({ ...originalMovement, quantity: 6 }, snapshot, 'Shipment');
  for (const id of [undefined, null, '', ' ', 123]) {
    assert.throws(
      () => snapshotStockMovement({ ...originalMovement, id }, 'Shipment'),
      /Shipment id was missing or invalid/,
    );
  }
});

test('movement preservation rejects changes to every selected immutable field', () => {
  const snapshot = snapshotStockMovement(originalMovement, 'Shipment');
  const changes = {
    id: 'other-id',
    type: 'INBOUND',
    referenceNo: 'other-reference',
    materialId: 'other-material',
    quantity: '6.00001',
    sourceLocationId: 'other-location',
    destLocationId: 'other-location',
    batchNo: 'other-batch',
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.throws(
      () => assertStockMovementUnchanged({ ...originalMovement, [field]: value }, snapshot, 'Shipment'),
      new RegExp(`Shipment changed ${field}`),
    );
  }
});

// Exercise the real CLI against a small, isolated HTTP fixture. This proves the
// journey actually invokes its preservation checks; it is not application UAT.
async function runJourneyFixture(mutation) {
  let received = 0;
  let stock = 0;
  let shipped = false;
  let reversalCalls = 0;
  let batchNo;
  const purchase = () => ({
    id: 'po',
    purchaseNo: 'PO1',
    status: received === 10 ? 'RECEIVED' : received ? 'PARTIAL_RECEIVED' : 'ORDERED',
    items: [{ id: 'purchase-line', quantity: '10', receivedQty: String(received) }],
    receipts: received === 10 ? [{ receiptNo: 'GR1' }, { receiptNo: 'GR2' }] : received ? [{ receiptNo: 'GR1' }] : [],
  });
  const order = () => ({
    id: 'so',
    orderNo: 'SO1',
    status: reversalCalls ? 'IN_PRODUCTION' : shipped ? 'SHIPPED' : 'DRAFT',
    taxCodeId: 'tax',
  });
  const movement = (name, data) => {
    if (mutation?.movement === name && reversalCalls >= mutation.afterReverseCall) {
      return { ...data, [mutation.field]: mutation.value };
    }
    return data;
  };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const route = new URL(request.url, 'http://localhost').pathname;
    let status = 200;
    let data;
    if (route === '/api/health') data = { status: 'ok' };
    else if (route === '/api/auth/login') {
      data = { accessToken: 'synthetic', companies: [{ id: 'company', name: completeEnv.BUSINESS_ACCEPTANCE_COMPANY_NAME }] };
    } else if (route === '/api/v1/resource/taxCode') data = [{ id: 'tax' }];
    else if (route.startsWith('/api/v1/resource/')) {
      const resource = route.split('/').at(-1);
      data = { ...body, id: { partner: 'partner', material: 'material', stockLocation: 'location', product: 'product' }[resource] };
    } else if (route === '/api/purchase/orders/po/receive') {
      if (body.lines[0].quantity === 7) {
        status = 400;
        data = {};
      } else {
        received += body.lines[0].quantity;
        stock += body.lines[0].quantity;
        batchNo = body.lines[0].batchNo;
        data = purchase();
      }
    } else if (route.startsWith('/api/purchase/orders')) data = purchase();
    else if (route === '/api/inventory/realtime-ledger') {
      data = stock ? [{ materialId: 'material', locationId: 'location', netQty: stock }] : [];
    } else if (route === '/api/orders' || route === '/api/orders/so') data = order();
    else if (route === '/api/inventory/posting/sale-order/so/ship') {
      if (stock < 6) {
        status = 400;
        data = {};
      } else {
        shipped = true;
        stock -= 6;
        data = { postedLines: [{ productId: 'product', quantity: 6, transactionId: 'shipment' }] };
      }
    } else if (route === '/api/inventory/posting/sale-order/so/reverse') {
      reversalCalls += 1;
      stock = 10;
      data = { returnDocument: { id: 'return' }, reversedLines: reversalCalls > 1 ? [] : [{ quantity: 6, transactionId: 'reversal' }] };
    } else if (route === '/api/inventory/transactions') {
      data = [
        ...(received >= 4 ? [movement('receipt', { id: 'receipt1', referenceNo: 'PURCHASE-IN-PO1-GR1', type: 'INBOUND', quantity: '4' })] : []),
        ...(received === 10 ? [{ id: 'receipt2', referenceNo: 'PURCHASE-IN-PO1-GR2', type: 'INBOUND', quantity: '6' }] : []),
        ...(shipped ? [movement('shipment', { ...originalMovement, batchNo, quantity: reversalCalls ? '6.0000' : 6 })] : []),
        ...(reversalCalls ? [movement('reversal', { id: 'reversal', referenceNo: 'SALE-SHIP-REV-SO1', type: 'INBOUND', materialId: 'material', quantity: '6', sourceLocationId: null, destLocationId: 'location', batchNo })] : []),
      ];
    } else {
      status = 404;
      data = {};
    }
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(data));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve) => {
      execFile(process.execPath, [fileURLToPath(new URL('./stocked-trade-acceptance.mjs', import.meta.url))], {
        timeout: 5_000,
        env: {
          ...process.env,
          ...completeEnv,
          API_BASE_URL: `http://127.0.0.1:${server.address().port}/api`,
          STOCKED_TRADE_HTTP_TIMEOUT_MS: '15000',
          STOCKED_TRADE_ACCEPTANCE_REPORT: '',
        },
      }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, output: `${stdout}${stderr}` }));
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('CLI preservation gate accepts the baseline and rejects tampering or missing IDs', async (t) => {
  await t.test('unchanged movements pass all journey steps', async () => {
    const result = await runJourneyFixture();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /HTTP UAT PASSED \(13\/13 steps\)/);
  });
  const cases = [
    { movement: 'shipment', afterReverseCall: 1, field: 'quantity', value: 999, expected: /Original shipment after reversal changed quantity/ },
    { movement: 'shipment', afterReverseCall: 1, field: 'materialId', value: 'other-material', expected: /Original shipment after reversal changed materialId/ },
    { movement: 'shipment', afterReverseCall: 2, field: 'batchNo', value: 'other-batch', expected: /Original shipment after replay changed batchNo/ },
    { movement: 'reversal', afterReverseCall: 2, field: 'destLocationId', value: 'other-location', expected: /Reversal movement after replay changed destLocationId/ },
    { movement: 'shipment', afterReverseCall: 0, field: 'id', value: undefined, expected: /Sales shipment movement id was missing or invalid/ },
    { movement: 'reversal', afterReverseCall: 1, field: 'id', value: undefined, expected: /Reversal movement id was missing or invalid/ },
    { movement: 'receipt', afterReverseCall: 0, field: 'id', value: undefined, expected: /A receipt transaction id was missing or invalid/ },
  ];
  for (const mutation of cases) {
    await t.test(`${mutation.movement} ${mutation.field} mutation after ${mutation.afterReverseCall} reversals fails`, async () => {
      const result = await runJourneyFixture(mutation);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, mutation.expected);
      assert.match(result.output, /HTTP UAT FAILED/);
    });
  }
});
