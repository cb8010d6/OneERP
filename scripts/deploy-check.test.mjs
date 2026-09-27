import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pathEntries = (process.env.PATH || '').split(path.delimiter);
const findOnPath = (command) => pathEntries.map((entry) => path.join(entry, command)).find((candidate) => existsSync(candidate));
const powershell = process.env.PWSH_PATH || findOnPath(process.platform === 'win32' ? 'pwsh.exe' : 'pwsh') ||
  (process.platform === 'win32' ? findOnPath('powershell.exe') : undefined);
const powershellProbe = powershell ? spawnSync(powershell, ['-NoProfile', '-Command', 'exit 0']) : undefined;
const hasPowerShell = Boolean(powershell && !powershellProbe.error && powershellProbe.status === 0);

const fakeDocker = String.raw`#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const scenario = process.env.FAKE_DOCKER_CASE || 'passing';
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n');
if (args[0] === 'version') process.exit(0);
if (args[0] === 'inspect') {
  const id = args[args.length - 1];
  const service = id.replace(/^id-/, '');
  let status = 'running';
  let health = 'healthy';
  let code = '0';
  if (scenario === 'exited' && service === 'api') { status = 'exited'; health = 'none'; code = '1'; }
  if (scenario === 'starting' && service === 'api') health = 'starting';
  if (scenario === 'starting-then-healthy' && service === 'api') {
    const log = process.env.FAKE_DOCKER_LOG;
    const priorCalls = log && fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
          .filter((call) => call[0] === 'inspect' && call[call.length - 1] === 'id-api').length
      : 0;
    if (priorCalls === 1) health = 'starting';
  }
  if (scenario === 'unhealthy' && service === 'db') health = 'unhealthy';
  if (service === 'migrate') {
    status = scenario === 'migration-running' ? 'running' : 'exited';
    health = 'none';
    code = scenario === 'migration-failed' ? '7' : '0';
  }
  process.stdout.write([status, health, code].join('|') + '\n');
  process.exit(0);
}
if (args[0] === 'compose') {
  const composeArgs = args.slice(1);
  if (composeArgs.includes('config')) {
    if (composeArgs.includes('--services')) {
      let services = (process.env.FAKE_COMPOSE_SERVICES || 'api,web,db,redis,minio,migrate,nginx').split(',');
      if (scenario === 'missing-config-service') services = services.filter((name) => name !== 'api');
      process.stdout.write(services.join('\n') + '\n');
    }
    process.exit(0);
  }
  if (composeArgs.includes('ps')) {
    const q = composeArgs.indexOf('-q');
    const service = q >= 0 ? composeArgs[q + 1] : '';
    if (((scenario === 'missing-service' && service === 'api') || (scenario === 'migration-missing' && service === 'migrate')) || !service || service === 'nginx') process.exit(0);
    process.stdout.write('id-' + service + '\n');
    process.exit(0);
  }
}
process.stderr.write('unexpected fake docker arguments\n');
process.exit(2);
`;

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'oneerp-deploy-check-'));
  const scripts = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  mkdirSync(scripts);
  mkdirSync(bin);
  copyFileSync(path.join(repoRoot, 'scripts', 'deploy-check.sh'), path.join(scripts, 'deploy-check.sh'));
  copyFileSync(path.join(repoRoot, 'scripts', 'deploy-check.ps1'), path.join(scripts, 'deploy-check.ps1'));
  writeFileSync(path.join(root, 'selected-compose.yml'), 'services: {}\n');
  writeFileSync(path.join(root, 'docker-compose.ha-lite.yml'), 'services: {}\n');
  const envFile = path.join(root, 'selected.env');
  const secretValues = [
    'pg-secret-value-for-test-0001',
    'jwt-secret-value-for-test-0002',
    'minio-secret-value-for-test-003',
    'admin-secret-value-for-test-004',
  ];
  writeFileSync(envFile, [
    `POSTGRES_PASSWORD=${secretValues[0]}`,
    `JWT_SECRET=${secretValues[1]}`,
    `MINIO_SECRET_KEY=${secretValues[2]}`,
    `INIT_ADMIN_PASSWORD=${secretValues[3]}`,
    'API_PORT=8000',
    'WEB_PORT=3000',
  ].join('\n') + '\n');
  copyFileSync(envFile, path.join(root, '.env'));
  const fakeDockerPath = path.join(bin, 'docker.mjs');
  writeFileSync(fakeDockerPath, fakeDocker);
  if (process.platform === 'win32') {
    writeFileSync(path.join(bin, 'docker.cmd'), '@echo off\r\nnode "%~dp0docker.mjs" %*\r\n');
  } else {
    const dockerPath = path.join(bin, 'docker');
    writeFileSync(dockerPath, '#!/bin/sh\nexec node "$(dirname "$0")/docker.mjs" "$@"\n');
    chmodSync(dockerPath, 0o755);
    const curlPath = path.join(bin, 'curl');
    writeFileSync(curlPath, '#!/bin/sh\nexit 0\n');
    chmodSync(curlPath, 0o755);
  }
  return { root, bin, envFile, composeFile: path.join(root, 'selected-compose.yml'), secretValues };
}

function runShell(fx, scenario, timeoutSeconds = 0) {
  const log = path.join(fx.root, 'docker-args.jsonl');
  const result = spawnSync('sh', [path.join(fx.root, 'scripts', 'deploy-check.sh')], {
    cwd: fx.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.bin}${path.delimiter}${process.env.PATH || ''}`,
      COMPOSE_FILE: 'selected-compose.yml',
      ENV_FILE: 'selected.env',
      DEPLOY_CHECK_TIMEOUT_SECONDS: String(timeoutSeconds),
      DEPLOY_CHECK_POLL_SECONDS: '1',
      FAKE_DOCKER_CASE: scenario,
      FAKE_DOCKER_LOG: log,
    },
  });
  return { ...result, log, report: readFileSync(path.join(fx.root, 'deploy-check-report.json'), 'utf8') };
}

function runPowerShell(fx, scenario, timeoutSeconds = 0, selectedFiles = true) {
  const log = path.join(fx.root, 'docker-args.jsonl');
  const script = path.join(fx.root, 'scripts', 'deploy-check.ps1').replaceAll("'", "''");
  const command = `function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) [pscustomobject]@{ StatusCode = 200 } }; & '${script}' -TimeoutSeconds ${timeoutSeconds}`;
  const env = {
    ...process.env,
    PATH: `${fx.bin}${path.delimiter}${process.env.PATH || ''}`,
    COMPOSE_FILE: 'selected-compose.yml',
    ENV_FILE: 'selected.env',
    FAKE_DOCKER_CASE: scenario,
    FAKE_DOCKER_LOG: log,
  };
  if (!selectedFiles) {
    delete env.COMPOSE_FILE;
    delete env.ENV_FILE;
    delete env.API_BASE_URL;
    delete env.WEB_BASE_URL;
  }
  const result = spawnSync(powershell, ['-NoProfile', '-Command', command], {
    cwd: fx.root,
    encoding: 'utf8',
    env,
  });
  return { ...result, log, report: readFileSync(path.join(fx.root, 'deploy-check-report.json'), 'utf8') };
}

function assertNoSecretLeak(result, secretValues) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}\n${result.report}`;
  for (const value of secretValues) assert.equal(combined.includes(value), false, 'secret value was emitted');
}

const scenarios = [
  { name: 'missing service container', scenario: 'missing-service', output: 'runtime-api', detail: 'not present' },
  { name: 'service exited', scenario: 'exited', output: 'runtime-api', detail: 'status=exited' },
  { name: 'health still starting at the deadline', scenario: 'starting', output: 'runtime-api', detail: 'timed out' },
  { name: 'service unhealthy', scenario: 'unhealthy', output: 'runtime-db', detail: 'unhealthy' },
  { name: 'migration exit code is nonzero', scenario: 'migration-failed', output: 'runtime-migrate', detail: 'exitCode=7' },
  { name: 'declared migration container is missing', scenario: 'migration-missing', output: 'runtime-migrate', detail: 'not present' },
  { name: 'declared migration is still running at the deadline', scenario: 'migration-running', output: 'runtime-migrate', detail: 'status=running' },
  { name: 'required service missing from selected config', scenario: 'missing-config-service', output: 'runtime-api', detail: 'not defined' },
];

for (const { name, scenario, output, detail } of scenarios) {
  test(`deploy-check.sh fails when ${name}`, (t) => {
    const fx = fixture();
    t.after(() => rmSync(fx.root, { recursive: true, force: true }));
    const result = runShell(fx, scenario);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`\\[FAIL\\] ${output}`));
    assert.match(result.stdout, new RegExp(detail));
    assertNoSecretLeak(result, fx.secretValues);
  });

  test(`deploy-check.ps1 fails when ${name}`, { skip: !hasPowerShell }, (t) => {
    const fx = fixture();
    t.after(() => rmSync(fx.root, { recursive: true, force: true }));
    const result = runPowerShell(fx, scenario);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`\\[FAIL\\] runtime-${output.replace('runtime-', '')}`));
    assert.match(result.stdout, new RegExp(detail));
    assertNoSecretLeak(result, fx.secretValues);
  });
}

test('deploy-check.sh passes for healthy runtime services and a successful one-shot migration', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const result = runShell(fx, 'passing');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[PASS\] runtime-api/);
  assert.match(result.stdout, /\[PASS\] runtime-migrate/);
  assert.match(result.report, /"failed": 0/);
  const calls = readFileSync(result.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(calls.some((args) => args.includes('--env-file') && args.includes(fx.envFile)));
  assert.ok(calls.some((args) => args.includes('-f') && args.includes(fx.composeFile)));
  assert.ok(calls.some((args) => args.includes('--all') && args.includes('-q')));
  assert.equal(calls.some((args) => args.includes('ps') && args.includes('nginx')), false, 'profile-only nginx must not be required');
  assertNoSecretLeak(result, fx.secretValues);
});

test('deploy-check.ps1 passes for healthy runtime services and a successful one-shot migration', { skip: !hasPowerShell }, (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const result = runPowerShell(fx, 'passing');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[PASS\] runtime-api/);
  assert.match(result.stdout, /\[PASS\] runtime-migrate/);
  const calls = readFileSync(result.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(calls.some((args) => args.includes('--env-file') && args.includes(fx.envFile)));
  assert.ok(calls.some((args) => args.includes('-f') && args.includes(fx.composeFile)));
  assert.ok(calls.some((args) => args.includes('--all') && args.includes('-q')));
  assert.equal(calls.some((args) => args.includes('ps') && args.includes('nginx')), false, 'profile-only nginx must not be required');
  assertNoSecretLeak(result, fx.secretValues);
});

test('deploy-check.sh waits for health starting to become healthy', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const result = runShell(fx, 'starting-then-healthy', 5);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[PASS\] runtime-api/);
});

test('deploy-check.ps1 waits for health starting to become healthy', { skip: !hasPowerShell }, (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const result = runPowerShell(fx, 'starting-then-healthy', 5);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[PASS\] runtime-api/);
});

test('deploy-check.ps1 uses HA-lite and .env defaults when Compose env vars are unset', { skip: !hasPowerShell }, (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const result = runPowerShell(fx, 'passing', 0, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = readFileSync(result.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(calls.some((args) => args.includes('-f') && args.includes(path.join(fx.root, 'docker-compose.ha-lite.yml'))));
  assert.ok(calls.some((args) => args.includes('--env-file') && args.includes(path.join(fx.root, '.env'))));
});
