import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkWeb, composeArgs, loopbackPort, requireCi, runRehearsal, summarizeJourney } from './container-rehearsal.mjs';

const ci = { CI: 'true', GITHUB_ACTIONS: 'true', ONEERP_CONTAINER_REHEARSAL: '1' };
const imageId = `sha256:${'a'.repeat(64)}`;
const sha = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const containerId = 'd'.repeat(64);

test('opt-in and local Docker guards fail closed', () => {
  for (const env of [{}, { CI: 'true' }, { ...ci, ONEERP_CONTAINER_REHEARSAL: '0' },
    { ...ci, DOCKER_HOST: 'ssh://production' }, { ...ci, DOCKER_CONTEXT: 'production' }]) {
    assert.throws(() => requireCi(env));
  }
  assert.doesNotThrow(() => requireCi(ci));
  assert.throws(() => composeArgs({ project: 'oneerp-production' }, ['down', '--volumes']));
  assert.throws(() => loopbackPort('0.0.0.0:8000'));
  assert.throws(() => loopbackPort('127.0.0.1:8000\n127.0.0.1:8001'));
  assert.equal(loopbackPort('127.0.0.1:32123\n'), 'http://127.0.0.1:32123');
});

test('complete journey count is required and report does not propagate context', () => {
  const report = { passed: true, context: { token: 'do-not-publish' }, steps: Array.from({ length: 13 }, () => ({ passed: true })) };
  assert.deepEqual(summarizeJourney(report, 13), { passed: true, passedSteps: 13, expectedSteps: 13 });
  assert.throws(() => summarizeJourney(report, 12));
  assert.throws(() => summarizeJourney({ ...report, steps: report.steps.map(() => ({ passed: false })) }, 13));
});

function webFetch(company = 'OneERP Synthetic HTTP Journey test', missingAsset = false) {
  return async (url) => {
    const route = new URL(url).pathname;
    if (route === '/login') return new Response('<script src="/_next/static/a.js"></script><link href="/_next/static/a.css" rel="stylesheet">', { headers: { 'content-type': 'text/html' } });
    if (route.startsWith('/_next/static/')) return new Response(missingAsset ? '<html>missing</html>' : 'content', { headers: { 'content-type': missingAsset ? 'text/html' : 'text/plain' } });
    if (route.endsWith('/health')) return Response.json({ status: 'ok' });
    if (route.endsWith('/auth/login')) return Response.json({ accessToken: 'private-token', companies: [{ name: company }] });
    throw new Error('Unexpected HTTP request');
  };
}

test('Web check requires real static assets and API proxy login', async () => {
  const company = 'OneERP Synthetic HTTP Journey test';
  const result = await checkWeb('http://127.0.0.1:3000', { email: 'test', password: 'secret' }, company, webFetch(company));
  assert.equal(result.staticAssets, 2);
  await assert.rejects(checkWeb('http://127.0.0.1:3000', {}, company, webFetch(company, true)), /static asset/);
  await assert.rejects(checkWeb('http://127.0.0.1:3000', {}, 'wrong company', webFetch(company)), /synthetic company/);
});

async function harness(t, { failStage, dirty = false, endpoint = 'unix:///var/run/docker.sock' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rehearsal-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reportPath = path.join(dir, 'report.json');
  const commands = [];
  let generated;
  let envFile;
  const runner = async (command, args, options) => {
    commands.push({ command, args });
    generated = options.env;
    if (command === 'git') {
      if (args[0] === 'status') return dirty ? ' M apps/api/src/main.ts' : '';
      return args[1] === 'HEAD' ? sha : tree;
    }
    if (command === process.execPath) {
      const count = args[0].endsWith('stocked-trade-acceptance.mjs') ? 13 : 12;
      await writeFile(args[2], JSON.stringify({ passed: true, context: { token: 'private-token' }, steps: Array.from({ length: count }, () => ({ passed: true })) }));
      return '';
    }
    assert.equal(command, 'docker');
    if (args[0] === 'context') return endpoint;
    if (args[0] === 'image' || args[0] === 'inspect') return imageId;
    if (args[0] === 'compose' && args.includes('--env-file')) {
      envFile = args[args.indexOf('--env-file') + 1];
      const action = args.slice(args.indexOf('--project-name') + 2);
      if (failStage === 'migrate' && action[0] === 'run' && action.at(-1) === 'migrate') throw new Error(generated.INIT_ADMIN_PASSWORD);
      if (action[0] === 'ps') return containerId;
      if (action[0] === 'port') return action[1] === 'api' ? '127.0.0.1:31000' : '127.0.0.1:31001';
    }
    return '';
  };
  const options = { root: '/reviewed/source', env: { ...ci, RUNNER_TEMP: dir, CONTAINER_REHEARSAL_REPORT: reportPath }, runner,
    log: () => {}, fetchImpl: async (url, options) => webFetch(generated.INIT_COMPANY_NAME)(url, options),
    recover: async (options) => {
      assert.match(options.sourceProject, /^oneerp-ci-[a-f0-9]{24}$/);
      assert.equal(options.recoveryProject, `${options.sourceProject}-restore`);
      assert.equal(options.credentials.password, generated.INIT_ADMIN_PASSWORD);
      assert.equal(options.journeyReports.manufacturing.steps.length, 12);
      return { status: 'passed', checks: [{ name: 'restored-files', status: 'passed' }], verifiedFileCount: 1,
        objectEvidenceDigest: 'e'.repeat(64), businessTables: [{ table: 'FileRecord', count: 1 }], credentials: 'never publish' };
    } };
  return { options, commands, reportPath, getGenerated: () => generated, getEnvFile: () => envFile };
}

test('dirty checkout and remote Docker daemon stop before build or cleanup', async (t) => {
  for (const scenario of [{ dirty: true }, { endpoint: 'ssh://production' }]) {
    const h = await harness(t, scenario);
    await assert.rejects(runRehearsal(h.options));
    assert.equal(h.commands.filter(({ args }) => args[0] === 'build' || args.includes('down')).length, 0);
    assert.equal(JSON.parse(await readFile(h.reportPath, 'utf8')).status, 'failed');
  }
});

test('migration failure cleans only allocated random projects and writes no secrets', async (t) => {
  const h = await harness(t, { failStage: 'migrate' });
  await assert.rejects(runRehearsal(h.options), /migrate-and-initialize/);
  const cleanups = h.commands.filter(({ args }) => args.includes('down'));
  assert.equal(cleanups.length, 2);
  for (const { args } of cleanups) {
    assert.match(args[args.indexOf('--project-name') + 1], /^oneerp-ci-[a-f0-9]{24}(?:-restore)?$/);
    assert.ok(args.includes('--volumes'));
  }
  assert.equal(h.commands.some(({ command }) => command === process.execPath), false);
  const raw = await readFile(h.reportPath, 'utf8');
  assert.equal(raw.includes(h.getGenerated().INIT_ADMIN_PASSWORD), false);
  assert.equal(JSON.parse(raw).status, 'failed');
  await assert.rejects(access(h.getEnvFile()));
});

test('successful mocked rehearsal records actual source, image IDs, 25 steps and sanitized recovery', async (t) => {
  const h = await harness(t);
  const result = await runRehearsal(h.options);
  assert.equal(result.status, 'passed');
  assert.equal(result.commit, sha);
  assert.equal(result.tree, tree);
  assert.equal(result.images.api.id, imageId);
  assert.equal(result.journeys.stockedTrade.passedSteps + result.journeys.manufacturing.passedSteps, 25);
  assert.equal(result.recovery.verifiedFileCount, 1);
  assert.equal(h.commands.filter(({ args }) => args[0] === 'build').length, 4);
  const raw = await readFile(h.reportPath, 'utf8');
  for (const secret of [h.getGenerated().POSTGRES_PASSWORD, h.getGenerated().JWT_SECRET,
    h.getGenerated().MINIO_SECRET_KEY, h.getGenerated().INIT_ADMIN_PASSWORD, 'private-token', 'never publish']) {
    assert.equal(raw.includes(secret), false);
  }
  await assert.rejects(access(h.getEnvFile()));
});

test('recovery failure retains only safe failed stage evidence and still cleans up', async (t) => {
  const h = await harness(t);
  h.options.recover = async ({ reportPath }) => {
    await writeFile(reportPath, JSON.stringify({ status: 'failed',
      checks: [{ name: 'restored-row-verification', status: 'failed', reason: 'secret details' }],
      password: 'never-publish' }));
    throw new Error('never-publish');
  };
  await assert.rejects(runRehearsal(h.options), /backup-and-fresh-volume-recovery/);
  const raw = await readFile(h.reportPath, 'utf8');
  assert.deepEqual(JSON.parse(raw).recovery, { status: 'failed', checks: [{ name: 'restored-row-verification', status: 'failed' }] });
  assert.equal(raw.includes('never-publish'), false);
  assert.equal(raw.includes('secret details'), false);
  assert.equal(h.commands.filter(({ args }) => args.includes('down')).length, 2);
});
