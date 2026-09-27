#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT_PATTERN = /^oneerp-ci-[a-f0-9]{24}(?:-restore)?$/;
const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function requireCi(env) {
  assert(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.ONEERP_CONTAINER_REHEARSAL === '1',
    'Disposable rehearsal requires CI=true, GITHUB_ACTIONS=true and ONEERP_CONTAINER_REHEARSAL=1');
  assert(!env.DOCKER_HOST && (!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'),
    'Disposable rehearsal refuses an overridden Docker host or context');
}

export function composeArgs({ root, composeFile, envFile, project }, args) {
  assert(PROJECT_PATTERN.test(project), 'Refusing a non-rehearsal Compose project');
  return ['compose', '--project-directory', root, '--env-file', envFile,
    '--file', composeFile, '--project-name', project, ...args];
}

export function loopbackPort(value) {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(value.trim());
  const port = Number(match?.[1]);
  assert(match && port >= 1 && port <= 65535, 'Compose did not publish exactly one loopback port');
  return `http://127.0.0.1:${port}`;
}

export function summarizeJourney(report, expectedSteps) {
  assert(report?.passed === true && Array.isArray(report.steps)
    && report.steps.length === expectedSteps && report.steps.every((step) => step.passed === true),
  'HTTP journey did not pass its complete expected step set');
  return { passed: true, passedSteps: report.steps.length, expectedSteps };
}

function summarizeRecovery(result) {
  return { status: result.status,
    checks: result.checks?.map(({ name, status }) => ({ name, status })),
    verifiedFileCount: result.verifiedFileCount,
    objectEvidenceDigest: result.objectEvidenceDigest,
    businessTables: result.businessTables?.map(({ table, count }) => ({ table, count })),
  };
}

// No shell, secret-bearing command text, or unbounded process output. Diagnostics
// stay in memory and are never included in the public evidence artifact.
export function runCommand(command, args, { cwd = ROOT, env = process.env,
  timeoutMs = 120_000, signal, onFailureOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let output = '';
    let diagnostics = '';
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    const collect = (chunk) => {
      output = `${output}${chunk}`.slice(-131_072);
      diagnostics = `${diagnostics}${chunk}`.slice(-131_072);
    };
    child.stdout.on('data', collect);
    // Do not mix stderr with machine-readable stdout.
    child.stderr.on('data', (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-131_072); });
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (timedOut || code !== 0) {
        onFailureOutput?.(diagnostics);
        reject(new Error(timedOut ? 'Command timed out' : `Command exited ${code}`));
      } else resolve(output.trim());
    });
  });
}

export async function checkWeb(webBaseUrl, credentials, companyName, fetchImpl = fetch) {
  const request = async (route, options = {}) => {
    const response = await fetchImpl(`${webBaseUrl}${route}`, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    assert(response.ok, 'Web or its API proxy returned a non-success response');
    return response;
  };
  const page = await request('/login');
  assert(page.headers.get('content-type')?.includes('text/html'), 'Web login did not return HTML');
  const html = await page.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)]
    .map((match) => match[1]))];
  assert(assets.length > 0 && assets.length <= 64 && assets.some((asset) => /\.js(?:\?|$)/.test(asset)),
    'Web login did not reference a bounded set of production JavaScript assets');
  for (const asset of assets) {
    const url = new URL(asset, webBaseUrl);
    assert(url.origin === webBaseUrl && url.pathname.startsWith('/_next/static/'), 'Invalid Web static asset path');
    const response = await request(`${url.pathname}${url.search}`);
    assert(!response.headers.get('content-type')?.includes('text/html')
      && (await response.arrayBuffer()).byteLength > 0, 'Web static asset was missing or returned HTML');
  }
  const health = await (await request('/api/proxy/health')).json();
  assert(health.status === 'ok', 'Web proxy health did not reach the API');
  const login = await (await request('/api/proxy/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })).json();
  assert(typeof login.accessToken === 'string' && login.accessToken.length > 0
    && login.companies?.filter((company) => company.name === companyName).length === 1,
  'Web proxy login did not select the synthetic company');
  return { loginPage: 'passed', staticAssets: assets.length, apiHealthProxy: 'passed', loginProxy: 'passed' };
}

export async function runRehearsal({ root = ROOT, env = process.env, runner = runCommand,
  fetchImpl = fetch, recover, log = console.log, signal } = {}) {
  requireCi(env);
  const reportPath = path.resolve(env.CONTAINER_REHEARSAL_REPORT
    || path.join(env.RUNNER_TEMP || tmpdir(), 'container-rehearsal-report.json'));
  const tempDir = await mkdtemp(path.join(env.RUNNER_TEMP || tmpdir(), 'oneerp-container-'));
  const nonce = randomBytes(12).toString('hex');
  const sourceProject = `oneerp-ci-${nonce}`;
  const recoveryProject = `${sourceProject}-restore`;
  const composeFile = path.join(root, 'scripts/ci/compose.rehearsal.yml');
  const envFile = path.join(tempDir, 'rehearsal.env');
  const imageTags = Object.fromEntries(['api', 'migrate', 'web', 'minio'].map((name) => [name, `${sourceProject}-${name}:local`]));
  const generated = {
    POSTGRES_USER: 'oneerp_ci', POSTGRES_DB: 'oneerp_ci', POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
    JWT_SECRET: randomBytes(48).toString('hex'), MINIO_ACCESS_KEY: `ci${randomBytes(12).toString('hex')}`,
    MINIO_SECRET_KEY: randomBytes(32).toString('hex'), INIT_ADMIN_EMAIL: `${sourceProject}@example.invalid`,
    INIT_ADMIN_PASSWORD: `Ci!${randomBytes(32).toString('hex')}`,
    INIT_COMPANY_NAME: `OneERP Synthetic HTTP Journey ${nonce}`,
    REHEARSAL_API_IMAGE: imageTags.api, REHEARSAL_MIGRATE_IMAGE: imageTags.migrate,
    REHEARSAL_WEB_IMAGE: imageTags.web, REHEARSAL_MINIO_IMAGE: imageTags.minio,
  };
  for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'INIT_ADMIN_PASSWORD']) {
    log(`::add-mask::${generated[key]}`);
  }
  const dockerEnv = { ...env, ...generated, COMPOSE_DISABLE_ENV_FILE: 'true', DOCKER_BUILDKIT: '1' };
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES']) delete dockerEnv[key];
  const report = { schemaVersion: 1, scope: 'disposable-current-head-container-rehearsal',
    status: 'failed', startedAt: new Date().toISOString(), commit: null, tree: null,
    images: {}, checks: [], limitations: ['CI-only MinIO source image; production distribution issue #35 remains open',
      'Synthetic data; no production deployment, TLS, offsite backup, RPO certification or business sign-off'] };
  const call = (command, args, options = {}) => runner(command, args, { cwd: root, env: dockerEnv, signal, ...options });
  const compose = (args, options = {}, project = sourceProject) => call('docker',
    composeArgs({ root, composeFile, envFile, project }, args), options);
  const step = async (name, fn) => {
    log(`[START] ${name}`);
    try {
      const result = await fn();
      report.checks.push({ name, status: 'passed' });
      log(`[PASS] ${name}`);
      return result;
    } catch {
      report.checks.push({ name, status: 'failed' });
      throw new Error(`Container rehearsal failed at ${name}`);
    }
  };
  let failure;
  let mayHaveContainers = false;
  try {
    await writeFile(envFile, Object.entries(generated).map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join(''), { mode: 0o600 });
    await step('clean-current-head', async () => {
      report.commit = await call('git', ['rev-parse', 'HEAD']);
      report.tree = await call('git', ['rev-parse', 'HEAD^{tree}']);
      assert(/^[a-f0-9]{40}$/.test(report.commit) && /^[a-f0-9]{40}$/.test(report.tree), 'Invalid Git identity');
      assert(!(await call('git', ['status', '--porcelain', '--untracked-files=all'])), 'Build requires a clean source checkout');
    });
    await step('local-docker-and-compose', async () => {
      const endpoint = await call('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
      assert(endpoint === 'unix:///var/run/docker.sock', 'Only the local GitHub runner Docker socket is allowed');
      await call('docker', ['info', '--format', '{{.ServerVersion}}']);
      await call('docker', ['compose', 'version']);
      await compose(['config', '--quiet']);
    });
    for (const [name, dockerfile, target, context, minutes] of [
      ['migrate', 'apps/api/Dockerfile', 'builder', '.', 12],
      ['api', 'apps/api/Dockerfile', 'production', '.', 10],
      ['web', 'apps/web/Dockerfile', 'production', '.', 15],
      ['minio', 'scripts/ci/minio.Dockerfile', null, 'scripts/ci', 20],
    ]) {
      await step(`build-${name}-image`, async () => {
        const args = ['build', '--progress=plain', '--file', dockerfile, '--tag', imageTags[name]];
        if (target) args.push('--target', target, '--label', `org.opencontainers.image.revision=${report.commit}`);
        args.push(context);
        await call('docker', args, { timeoutMs: minutes * 60_000, onFailureOutput: (output) => {
          // Builds receive no secret build args. Still redact generated values and
          // prefix each line so untrusted build output cannot issue Actions commands.
          let safe = output;
          for (const value of Object.values(generated)) safe = safe.split(value).join('[REDACTED]');
          safe = safe.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(-16_384);
          log(safe.split('\n').slice(-80).map((line) => `[BUILD ${name}] ${line}`).join('\n'));
        } });
        const imageId = await call('docker', ['image', 'inspect', '--format', '{{.Id}}', imageTags[name]]);
        assert(IMAGE_ID_PATTERN.test(imageId), 'Invalid built image ID');
        report.images[name] = { id: imageId, target: target || 'CI-only verified source' };
      });
    }
    await step('start-isolated-dependencies', async () => {
      // Set before up: a partially failed up can still have created owned volumes.
      mayHaveContainers = true;
      await compose(['up', '--detach', '--wait', '--wait-timeout', '120', 'db', 'redis', 'minio'], { timeoutMs: 180_000 });
      for (const name of ['db', 'redis', 'minio']) {
        const container = await compose(['ps', '-q', name]);
        assert(/^[a-f0-9]{12,64}$/.test(container), 'Expected exactly one dependency container');
        const imageId = await call('docker', ['inspect', '--format', '{{.Image}}', container]);
        assert(IMAGE_ID_PATTERN.test(imageId), 'Invalid dependency image ID');
        if (name === 'minio') assert(imageId === report.images.minio.id, 'MinIO image changed after build');
        else report.images[name] = { id: imageId };
      }
      await compose(['run', '--rm', '--no-deps', '--entrypoint', 'node', 'api', '-e',
        "(async()=>{for(let i=0;i<60;i++){try{const r=await fetch('http://minio:9000/minio/health/ready',{signal:AbortSignal.timeout(2000)});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)})()"],
      { timeoutMs: 200_000 });
    });
    await step('migrate-and-initialize-production-schema', () => compose(['run', '--rm', '--no-deps', 'migrate'], { timeoutMs: 180_000 }));
    await step('start-production-api-and-web', async () => {
      await compose(['up', '--detach', '--no-deps', '--wait', '--wait-timeout', '180', 'api', 'web'], { timeoutMs: 240_000 });
      for (const name of ['api', 'web']) {
        const container = await compose(['ps', '-q', name]);
        assert(/^[a-f0-9]{12,64}$/.test(container), 'Expected exactly one application container');
        const imageId = await call('docker', ['inspect', '--format', '{{.Image}}', container]);
        assert(imageId === report.images[name].id, 'Running application image differs from built image');
      }
    });
    const apiBaseUrl = `${loopbackPort(await compose(['port', 'api', '8000']))}/api`;
    const webBaseUrl = loopbackPort(await compose(['port', 'web', '3000']));
    const credentials = { email: generated.INIT_ADMIN_EMAIL, password: generated.INIT_ADMIN_PASSWORD };
    report.web = await step('web-login-and-api-proxy', () => checkWeb(webBaseUrl, credentials, generated.INIT_COMPANY_NAME, fetchImpl));
    const journeyEnv = { ...dockerEnv, GITHUB_SHA: report.commit, API_BASE_URL: apiBaseUrl,
      STOCKED_TRADE_ACCEPTANCE: '1', MANUFACTURING_ACCEPTANCE: '1',
      BUSINESS_ACCEPTANCE_ADMIN_EMAIL: credentials.email, BUSINESS_ACCEPTANCE_ADMIN_PASSWORD: credentials.password,
      BUSINESS_ACCEPTANCE_COMPANY_NAME: generated.INIT_COMPANY_NAME };
    const journeyReports = {};
    report.journeys = {};
    for (const [name, file, expectedSteps] of [
      ['stockedTrade', 'stocked-trade-acceptance.mjs', 13], ['manufacturing', 'manufacturing-acceptance.mjs', 12],
    ]) {
      const journeyPath = path.join(tempDir, `${name}.json`);
      report.journeys[name] = await step(`http-${name}`, async () => {
        await call(process.execPath, [path.join(root, 'scripts', file), '--report', journeyPath], { env: journeyEnv, timeoutMs: 300_000 });
        journeyReports[name] = JSON.parse(await readFile(journeyPath, 'utf8'));
        return summarizeJourney(journeyReports[name], expectedSteps);
      });
    }
    report.recovery = await step('backup-and-fresh-volume-recovery', async () => {
      const runRecovery = recover || (await import('./recovery-rehearsal.mjs')).runRecovery;
      const recoveryReportPath = path.join(tempDir, 'recovery-report.json');
      let result;
      try {
        result = await runRecovery({ root, composeFile, envFile, sourceProject, recoveryProject,
          tempDir, reportPath: recoveryReportPath, commit: report.commit,
          credentials, apiBaseUrl, webBaseUrl, journeyReports, dockerEnv });
      } catch (error) {
        try { report.recovery = summarizeRecovery(JSON.parse(await readFile(recoveryReportPath, 'utf8'))); }
        catch { report.recovery = { status: 'failed' }; }
        throw error;
      }
      assert(result?.status === 'passed', 'Recovery did not pass');
      // Explicit allowlist: never copy generic context, failure output, or credentials.
      return summarizeRecovery(result);
    });
    await step('source-remains-current-head', async () => {
      assert(await call('git', ['rev-parse', 'HEAD']) === report.commit, 'Checkout changed during rehearsal');
      assert(await call('git', ['rev-parse', 'HEAD^{tree}']) === report.tree, 'Source tree changed during rehearsal');
      assert(!(await call('git', ['status', '--porcelain', '--untracked-files=all'])), 'Source changed during rehearsal');
    });
  } catch (error) {
    failure = error;
  } finally {
    if (mayHaveContainers) {
      let clean = true;
      for (const project of [recoveryProject, sourceProject]) {
        try {
          // Cleanup must remain available after a cancellation signal.
          await compose(['down', '--volumes', '--remove-orphans', '--timeout', '10'],
            { signal: undefined, timeoutMs: 60_000 }, project);
        } catch { clean = false; }
      }
      report.checks.push({ name: 'cleanup-owned-projects-and-volumes', status: clean ? 'passed' : 'failed' });
      if (!clean) failure ||= new Error('Container rehearsal cleanup failed');
    }
    await rm(tempDir, { recursive: true, force: true });
    report.status = failure ? 'failed' : 'passed';
    report.endedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const controller = new AbortController();
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => controller.abort());
  try {
    const report = await runRehearsal({ signal: controller.signal });
    console.log(`Container rehearsal ${report.status}: ${report.commit}`);
  } catch (error) {
    // Stage names are safe; never print child output, credentials, or raw config.
    console.error(error.message);
    process.exitCode = 1;
  }
}
