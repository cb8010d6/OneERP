#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApiClient, asNumber, normalizeApiBaseUrl, parseArgs,
  snapshotStockMovement, assertStockMovementUnchanged,
} from './stocked-trade-acceptance.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const rows = (response) => {
  const result = Array.isArray(response) ? response : response?.data;
  check(Array.isArray(result), 'API response did not contain a data array');
  return result;
};

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  check(env.MANUFACTURING_ACCEPTANCE === '1', 'Set MANUFACTURING_ACCEPTANCE=1 to enable synthetic HTTP UAT');
  const baseUrl = normalizeApiBaseUrl(env.API_BASE_URL);
  const companyName = env.BUSINESS_ACCEPTANCE_COMPANY_NAME?.trim();
  check(companyName?.startsWith('OneERP Synthetic HTTP Journey '),
    'BUSINESS_ACCEPTANCE_COMPANY_NAME must identify a OneERP Synthetic HTTP Journey tenant');
  const email = env.BUSINESS_ACCEPTANCE_ADMIN_EMAIL?.trim();
  const password = env.BUSINESS_ACCEPTANCE_ADMIN_PASSWORD;
  check(email && password, 'BUSINESS_ACCEPTANCE_ADMIN_EMAIL and BUSINESS_ACCEPTANCE_ADMIN_PASSWORD are required');
  const timeoutMs = Number(env.MANUFACTURING_HTTP_TIMEOUT_MS ?? 15000);
  check(Number.isInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 120000,
    'MANUFACTURING_HTTP_TIMEOUT_MS must be an integer from 250 to 120000');
  return { baseUrl, companyName, email, password, timeoutMs,
    reportPath: args.report || env.MANUFACTURING_ACCEPTANCE_REPORT || '' };
}

export async function login(config, email = config.email, password = config.password) {
  const api = new ApiClient(config.baseUrl, config.timeoutMs);
  const result = await api.post('/auth/login', { email, password });
  const companies = (Array.isArray(result?.companies) ? result.companies : [])
    .filter((company) => company.name === config.companyName);
  check(companies.length === 1 && companies[0]?.id && result?.accessToken,
    'Login must expose exactly one explicitly selected synthetic company and an access token');
  api.setAuth(result.accessToken, companies[0].id);
  return api;
}

export async function uploadDrawing(api, suffix) {
  const content = `%PDF-1.4\nSynthetic manufacturing acceptance drawing ${suffix}\n%%EOF\n`;
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'application/pdf' }), `${suffix}.pdf`);
  let response;
  let body;
  try {
    response = await fetch(`${api.baseUrl}/files/upload?folder=engineering`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(api.timeoutMs),
      headers: { Authorization: `Bearer ${api.accessToken}`, 'x-company-id': api.companyId },
      body: form,
    });
    body = await response.json();
  } catch {
    throw new Error('Synthetic drawing upload failed or timed out');
  }
  check(response.ok, `Synthetic drawing upload returned HTTP ${response.status}`);
  check(body?.id && body.checksumSha256 === createHash('sha256').update(content).digest('hex'),
    'Uploaded drawing did not retain its SHA-256 checksum');
  return body;
}

async function paginated(api, route, params = {}) {
  const result = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await api.get(route, { ...params, page, limit: 100 });
    result.push(...rows(response));
    check(Number.isInteger(response?.totalPages) && response.totalPages >= 0,
      'Paginated API response did not contain totalPages');
    if (page >= response.totalPages) return result;
  }
  throw new Error('Synthetic fixture read exceeded bounded pagination');
}

export async function runJourney(config, step, context) {
  const api = await step('login-and-select-synthetic-company', () => login(config));
  const suffix = `MFG-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  context.companyId = api.companyId;
  context.fixture = suffix;
  context.records = {};
  const create = async (model, data) => {
    const record = await api.post(`/v1/resource/${model}`, data);
    check(record?.id, `Synthetic ${model} creation did not return an id`);
    return record;
  };
  const fixture = await step('create-order-materials-and-default-bom', async () => {
    const partner = await create('partner', { code: `${suffix}-C`, name: suffix, type: 'CUSTOMER', isActive: true });
    const raw = await create('material', { sku: `${suffix}-RAW`, name: `${suffix} raw`, category: 'UAT', unit: 'pcs', unitPrice: 5, minStock: 0 });
    const finished = await create('material', { sku: `${suffix}-FG`, name: `${suffix} finished`, category: 'UAT', unit: 'pcs', unitPrice: 20, minStock: 0 });
    const warehouse = await create('warehouse', { name: suffix, type: 'MATERIAL' });
    const locations = {};
    for (const kind of ['raw', 'empty', 'finished']) {
      locations[kind] = await create('stockLocation', { name: `${suffix} ${kind}`, code: `${suffix}-${kind}`, warehouseId: warehouse.id, usage: 'INTERNAL', isActive: true });
    }
    const product = await create('product', { sku: `${suffix}-PRODUCT`, name: suffix, type: 'STOCKABLE', materialId: finished.id, listPrice: 20, uom: 'pcs', isActive: true });
    const taxCodes = rows(await api.get('/v1/resource/taxCode', { page: 1, limit: 100, filter: { active: true, isDefault: true } }));
    check(taxCodes.length === 1 && taxCodes[0].id, 'Expected exactly one active default tax code');
    const order = await api.post('/orders', { partnerId: partner.id, taxCodeId: taxCodes[0].id, items: [{ productId: product.id, quantity: 2 }] });
    check(order?.id && order.status === 'DRAFT', 'Expected a new draft sales order');
    const bom = await create('bom', { code: `${suffix}-BOM`, productId: product.id, version: 'UAT-1', isDefault: true });
    await create('bomLine', { bomId: bom.id, materialId: raw.id, quantity: 2, scrapRate: 0 });
    Object.assign(context.records, { orderId: order.id, productId: product.id, bomId: bom.id, rawMaterialId: raw.id, finishedMaterialId: finished.id });
    return { raw, finished, warehouse, locations, product, order };
  });

  // The real release API enforces different creator, reviewer and approver IDs.
  const actors = [];
  let revision;
  try {
    revision = await step('release-engineering-drawing-with-distinct-actors', async () => {
      const roles = rows(await api.get('/users/roles'));
      for (const roleName of ['EngineeringDesign', 'EngineeringReview', 'EngineeringApprover']) {
        const matches = roles.filter((role) => role.name === roleName);
        check(matches.length === 1 && matches[0].id, 'Required engineering role template was missing or ambiguous');
        const email = `${suffix}-${actors.length}@example.test`;
        const password = `Mfg!${randomBytes(18).toString('hex')}Aa1`;
        const user = await api.post('/users', { email, password, name: `${suffix} ${roleName}`, roleId: matches[0].id });
        check(user?.id, 'Synthetic engineering actor creation did not return an id');
        const actor = { id: user.id };
        actors.push(actor);
        actor.api = await login(config, email, password);
        check(actor.api.companyId === api.companyId, 'Engineering actor selected a different company');
      }
      check(new Set(actors.map((actor) => actor.id)).size === 3, 'Engineering actors must be distinct');
      const file = await uploadDrawing(actors[0].api, suffix);
      const document = await actors[0].api.post('/engineering-documents', { title: `${suffix} drawing`, documentType: 'DRAWING', productId: fixture.product.id, orderId: fixture.order.id, fileRecordId: file.id });
      const draft = document?.revisions?.[0];
      check(draft?.id && draft.status === 'DRAFT', 'Engineering draft revision was not created');
      const route = `/engineering-documents/revisions/${encodeURIComponent(draft.id)}`;
      check((await actors[0].api.post(`${route}/submit`, {}))?.status === 'PENDING_REVIEW', 'Drawing was not submitted');
      check((await actors[1].api.post(`${route}/review`, { decision: 'APPROVE', comment: 'Synthetic fixture review' }))?.status === 'PENDING_APPROVAL', 'Drawing was not reviewed');
      await actors[2].api.post(`${route}/release`, {});
      const released = rows(await api.get(`/engineering-documents/released-for-order/${encodeURIComponent(fixture.order.id)}`))
        .find((item) => item.id === document.id);
      check(released?.currentReleasedRevision?.id === draft.id && released.currentReleasedRevision.checksumSha256 === file.checksumSha256,
        'Released drawing identity or checksum did not match');
      context.records.engineeringRevisionId = draft.id;
      return draft;
    });
  } finally {
    // Only these newly created active actors are disabled; never toggle existing users.
    let cleanupFailed = false;
    for (const actor of actors) {
      try { await step('disable-synthetic-engineering-actor', async () => {
        const result = await api.request('PUT', `/users/${encodeURIComponent(actor.id)}/toggle-active`, {});
        check(result.body?.isActive === false, 'Synthetic actor was not disabled');
      }); } catch { cleanupFailed = true; }
    }
    check(!cleanupFailed, 'One or more synthetic engineering actors could not be disabled');
  }

  const workOrder = await step('receive-components-and-create-pinned-work-order', async () => {
    await api.post('/inventory/posting/purchase/inbound', { purchaseNo: `${suffix}-IN`, materialId: fixture.raw.id, quantity: 8, destLocationId: fixture.locations.raw.id, batchNo: `${suffix}-RAW-BATCH` });
    const created = await api.post('/production/orders', { orderId: fixture.order.id, productId: fixture.product.id, plannedQty: 2, engineeringRevisionIds: [revision.id] });
    check(created?.id && created.status === 'PENDING', 'Expected a pending work order');
    context.records.workOrderId = created.id;
    return created;
  });
  const state = async (rawQty, finishedQty, actualQty, status, movementCount) => {
    const ledger = await paginated(api, '/inventory/realtime-ledger', { warehouseId: fixture.warehouse.id });
    const quantity = (material, location) => ledger.filter((row) => row.materialId === material.id && row.locationId === location.id)
      .reduce((sum, row) => sum + asNumber(row.netQty, 'Ledger netQty'), 0);
    check(quantity(fixture.raw, fixture.locations.raw) === rawQty, 'Component stock differs from expected quantity');
    check(quantity(fixture.finished, fixture.locations.finished) === finishedQty, 'Finished stock differs from expected quantity');
    const order = (await paginated(api, '/production/orders')).find((item) => item.id === workOrder.id);
    check(order && asNumber(order.actualQty, 'Work order actualQty') === actualQty && order.status === status,
      'Work order progress or status differs from expected');
    check(order.engineeringRevisionPins?.some((pin) => pin.engineeringRevision?.id === revision.id), 'Work order lost released revision pin');
    const fixtureMoves = rows(await api.get('/inventory/transactions')).filter((item) =>
      [fixture.raw.id, fixture.finished.id].includes(item.materialId));
    check(fixtureMoves.length === movementCount, 'Unexpected number of fixture inventory movements');
    check(order.reports?.length === (movementCount === 1 ? 0 : 1), 'Unexpected number of work reports');
    return { rawQty, finishedQty, actualQty, status, movementCount };
  };
  const movements = async (ids) => {
    const transactions = rows(await api.get('/inventory/transactions'));
    return ids.map((id) => {
      const matches = transactions.filter((item) => item.id === id);
      check(matches.length === 1, 'Expected exactly one recorded inventory movement');
      return matches[0];
    });
  };
  const payload = { idempotencyKey: randomUUID(), goodQty: 2, defectQty: 0, sourceLocationId: fixture.locations.raw.id, destLocationId: fixture.locations.finished.id, batchNo: `${suffix}-FG-BATCH` };
  const reportRoute = `/production/orders/${encodeURIComponent(workOrder.id)}/report`;
  await step('insufficient-components-roll-back-report', async () => {
    await state(8, 0, 0, 'PENDING', 1);
    await api.postExpectStatus(reportRoute, { ...payload, idempotencyKey: randomUUID(), sourceLocationId: fixture.locations.empty.id }, 400);
    return state(8, 0, 0, 'PENDING', 1);
  });
  let originalMovements;
  const report = await step('report-consumes-bom-components-and-receives-finished-stock', async () => {
    const result = await api.post(reportRoute, payload);
    check(result?.id && !result.idempotentReplay && result.inventoryTransactionIds?.length === 2,
      'Report did not create exactly two inventory movements');
    originalMovements = (await movements(result.inventoryTransactionIds)).map((item) => snapshotStockMovement(item, 'Report movement'));
    const consumption = originalMovements.find((item) => item.materialId === fixture.raw.id);
    const receipt = originalMovements.find((item) => item.materialId === fixture.finished.id);
    check(consumption?.type === 'OUTBOUND' && consumption.quantity === 4 && consumption.sourceLocationId === fixture.locations.raw.id,
      'Report did not consume four BOM components');
    check(receipt?.type === 'INBOUND' && receipt.quantity === 2 && receipt.destLocationId === fixture.locations.finished.id,
      'Report did not receive two finished units');
    await state(4, 2, 2, 'COMPLETED', 3);
    context.records.reportId = result.id;
    return result;
  });
  const unchanged = async (snapshots) => {
    const current = await movements(snapshots.map((item) => item.id));
    current.forEach((item, index) => assertStockMovementUnchanged(item, snapshots[index], 'Recorded inventory movement'));
  };
  await step('report-replay-and-conflict-do-not-repost', async () => {
    const replay = await api.post(reportRoute, payload);
    check(replay?.id === report.id && replay.idempotentReplay, 'Report replay did not return original report');
    check(JSON.stringify(replay.inventoryTransactionIds) === JSON.stringify(report.inventoryTransactionIds), 'Report replay changed movement IDs');
    await api.postExpectStatus(reportRoute, { ...payload, goodQty: 1 }, 409);
    await unchanged(originalMovements);
    return state(4, 2, 2, 'COMPLETED', 3);
  });
  const reverseRoute = `/production/reports/${encodeURIComponent(report.id)}/reverse`;
  const reversalPayload = { idempotencyKey: randomUUID(), reason: 'Synthetic manufacturing correction' };
  let reversalMovements;
  const reversal = await step('reverse-report-restores-components-and-progress', async () => {
    const result = await api.post(reverseRoute, reversalPayload);
    check(result?.id && !result.idempotentReplay && result.inventoryTransactionIds?.length === 2, 'Reversal did not create two compensating movements');
    reversalMovements = (await movements(result.inventoryTransactionIds)).map((item) => snapshotStockMovement(item, 'Reversal movement'));
    check(new Set([...report.inventoryTransactionIds, ...result.inventoryTransactionIds]).size === 4, 'Reversal reused original movement IDs');
    for (const original of originalMovements) {
      const reversed = reversalMovements.find((item) => item.materialId === original.materialId);
      check(reversed?.quantity === original.quantity && reversed.type === (original.type === 'INBOUND' ? 'OUTBOUND' : 'INBOUND') && reversed.sourceLocationId === original.destLocationId && reversed.destLocationId === original.sourceLocationId && reversed.batchNo === original.batchNo,
        'Reversal did not compensate original movement');
    }
    await unchanged(originalMovements);
    await state(8, 0, 0, 'PENDING', 5);
    context.records.reversalId = result.id;
    return result;
  });
  await step('reversal-replay-and-conflict-preserve-restored-state', async () => {
    const replay = await api.post(reverseRoute, reversalPayload);
    check(replay?.id === reversal.id && replay.idempotentReplay, 'Reversal replay did not return original reversal');
    check(JSON.stringify(replay.inventoryTransactionIds) === JSON.stringify(reversal.inventoryTransactionIds), 'Reversal replay changed movement IDs');
    await api.postExpectStatus(reverseRoute, { ...reversalPayload, reason: 'Different synthetic reason' }, 409);
    await unchanged([...originalMovements, ...reversalMovements]);
    return state(8, 0, 0, 'PENDING', 5);
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const steps = [];
  const context = { sourceRevision: process.env.GITHUB_SHA || null };
  let config;
  let failed = false;
  const step = async (name, fn) => {
    try {
      const value = await fn();
      steps.push({ name, passed: true });
      console.log(`[PASS] ${name}`);
      return value;
    } catch (error) {
      steps.push({ name, passed: false, detail: error.message });
      throw error;
    }
  };
  try {
    config = loadConfig();
    await runJourney(config, step, context);
  } catch (error) {
    failed = true;
    if (!steps.some((item) => !item.passed)) steps.push({ name: 'setup', passed: false, detail: error.message });
    console.error(`[FAIL] ${error.message}`);
  }
  const report = { startedAt, endedAt: new Date().toISOString(), passed: !failed, context, steps };
  if (config?.reportPath) writeFileSync(path.resolve(config.reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Manufacturing HTTP UAT ${failed ? 'FAILED' : 'PASSED'} (${steps.filter((item) => item.passed).length}/${steps.length} steps)`);
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
