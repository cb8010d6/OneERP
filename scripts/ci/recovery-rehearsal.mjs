import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const services = ['db', 'redis', 'minio', 'api', 'web'];
export function assertRecoveryScope({ sourceProject, recoveryProject }, env = process.env) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.ONEERP_CONTAINER_REHEARSAL !== '1') throw new Error('Recovery requires disposable GitHub Actions CI');
  if (!/^oneerp-ci-[a-z0-9-]+$/.test(sourceProject) || recoveryProject !== `${sourceProject}-restore`) throw new Error('Recovery project must be the isolated CI restore project');
}
export function isolatedConfig(source, imageIds) {
  const result = { services: {}, volumes: {} };
  for (const name of services) {
    const original = source.services[name];
    if (!original || !/^sha256:[a-f0-9]{64}$/.test(imageIds[name])) throw new Error(`Missing immutable image for ${name}`);
    const service = structuredClone(original);
    delete service.build; delete service.container_name; delete service.ports; delete service.depends_on;
    delete service.networks; delete service.profiles;
    service.image = imageIds[name]; service.pull_policy = 'never'; service.restart = 'no';
    for (const volume of service.volumes || []) {
      if (volume.type !== 'volume' || !volume.source || source.volumes?.[volume.source]?.external) throw new Error('Recovery permits only project-owned named volumes');
      result.volumes[volume.source] = {};
    }
    result.services[name] = service;
  }
  return result;
}

// Read-only fingerprint includes every business row and its identity, not just counts.
const fingerprintSql = `SELECT format('SELECT %L AS table_name, count(*) AS row_count, md5(coalesce(string_agg(row_to_json(t)::text, %L ORDER BY row_to_json(t)::text), %L)) AS fingerprint FROM %I.%I t;', tablename, E'\\n', '', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`;
export const recoveryProbeCode = `
const crypto = require('node:crypto');
let input=''; process.stdin.on('data', b=>input+=b); process.stdin.on('end', async()=>{
try {
 const {email,password,companyName}=JSON.parse(input);
 const credentials={email,password};
 const base='http://127.0.0.1:8000/api';
 async function req(p, options={}) { const r=await fetch(base+p, options); if(!r.ok) throw Error('HTTP '+r.status); const j=await r.json(); return j.data ?? j; }
 const login=await req('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
 const token=login.access_token ?? login.accessToken; if(!token) throw Error('Missing login token');
 const companies=(login.companies || []).filter(c=>c.name===companyName);
 if(!companyName || companies.length!==1 || !companies[0].id) throw Error('Missing or ambiguous synthetic company');
 const files=await req('/files',{headers:{Authorization:'Bearer '+token,'x-company-id':companies[0].id}});
 if(!Array.isArray(files) || files.length===0) throw Error('No journey upload to verify');
 const result=[];
 for(const f of files) {
   if(!f.id || !f.checksumSha256 || !f.downloadUrl) throw Error('Incomplete file evidence');
   const u=new URL(f.downloadUrl); if(u.hostname!=='minio' || u.port!=='9000') throw Error('Unexpected object origin');
   const r=await fetch(u); if(!r.ok) throw Error('Object download failed');
   const checksum=crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
   if(checksum!==f.checksumSha256) throw Error('Object bytes checksum mismatch');
   result.push({id:f.id,checksumSha256:checksum});
 }
 result.sort((a,b)=>a.id.localeCompare(b.id));
 process.stdout.write(JSON.stringify({files:result}));
} catch { process.stderr.write('API recovery verification failed'); process.exitCode=1; }
});`;

export async function runRecovery(options) {
  const { root, composeFile, envFile, sourceProject, recoveryProject, tempDir, reportPath, commit, credentials, dockerEnv = process.env } = options;
  assertRecoveryScope(options);
  const checks = [];
  const report = { schemaVersion: 1, commit, scope: 'synthetic-ci-only', status: 'failed', checks };
  const recoveryDir = path.join(tempDir, 'recovery-private');
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  const restoreFile = path.join(recoveryDir, 'compose.json');
  let allocated = false;
  let stage = 'isolation-guards';
  function docker(args, input) {
    const result = spawnSync('docker', args, { cwd: root, env: dockerEnv, input, encoding: input instanceof Buffer ? null : 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 300000 });
    if (result.error || result.status !== 0) throw new Error('Recovery Docker operation failed');
    return result.stdout;
  }
  const source = (...args) => docker(['compose', '-p', sourceProject, '--env-file', envFile, '-f', composeFile, ...args]);
  const restore = (...args) => docker(['compose', '-p', recoveryProject, '-f', restoreFile, ...args]);
  function psql(project, sql) {
    const file = project === sourceProject ? composeFile : restoreFile;
    const envArgs = project === sourceProject ? ['--env-file', envFile] : [];
    return docker(['compose', '-p', project, ...envArgs, '-f', file, 'exec', '-T', 'db', 'sh', '-c', 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'], sql);
  }
  function snapshot(project) { return psql(project, psql(project, fingerprintSql)).trim(); }
  function probe(project) {
    const file = project === sourceProject ? composeFile : restoreFile;
    const envArgs = project === sourceProject ? ['--env-file', envFile] : [];
    return JSON.parse(docker(['compose', '-p', project, ...envArgs, '-f', file, 'exec', '-T', 'api', 'node', '-e', recoveryProbeCode], JSON.stringify({ ...credentials, companyName: dockerEnv.INIT_COMPANY_NAME })));
  }
  try {
    // Refuse even stopped containers or leftover volumes: never restore into existing data.
    for (const kind of ['container', 'volume']) {
      if (docker([kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', `label=com.docker.compose.project=${recoveryProject}`]).trim()) throw new Error('Recovery project is not fresh');
    }
    const config = JSON.parse(source('config', '--format', 'json'));
    const imageIds = {};
    const containers = {};
    for (const name of services) {
      containers[name] = source('ps', '-q', name).trim();
      if (!/^[a-f0-9]{12,64}$/.test(containers[name])) throw new Error(`Missing source service ${name}`);
      imageIds[name] = docker(['inspect', '--format', '{{.Image}}', containers[name]]).trim();
    }
    stage = 'source-api-and-backup';
    const sourceFiles = probe(sourceProject);
    // The event runner retries every 30s. Await a drained queue without altering it.
    let drained = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      const pending = psql(sourceProject, `SELECT count(*) FROM "EventDlq" WHERE status IN ('PENDING', 'RETRYING');`).trim();
      if (pending === '0') { drained = true; break; }
      if (!/^\d+$/.test(pending)) throw new Error('Invalid pending event count');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!drained) throw new Error('Synthetic event queue did not drain');
    const before = snapshot(sourceProject);
    if (!before.split('\n').some(line => /^EngineeringDocumentRevision\|[1-9][0-9]*\|/.test(line))) throw new Error('Missing engineering journey revision');
    const sql = source('exec', '-T', 'db', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges');
    // The same PostgreSQL alpine image supplies tar; no additional mutable helper image.
    const archive = docker(['run', '--rm', '--network', 'none', '--volumes-from', `${containers.minio}:ro`, '--entrypoint', 'tar', imageIds.db, 'czf', '-', '-C', '/data', '.'], Buffer.alloc(0));
    if (!sql || archive.length === 0 || before !== snapshot(sourceProject)) throw new Error('Source changed during backup');
    docker(['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'tar', imageIds.db, 'tzf', '-'], archive);
    checks.push({ name: 'backup-consistent', status: 'passed' });
    writeFileSync(restoreFile, JSON.stringify(isolatedConfig(config, imageIds)), { mode: 0o600 });
    allocated = true;
    stage = 'postgres-and-object-restore';
    restore('up', '-d', '--wait', '--wait-timeout', '180', 'db', 'redis');
    // Create MinIO without starting it so extraction precedes any object-store writes.
    restore('create', 'minio');
    const minio = restore('ps', '-a', '-q', 'minio').trim();
    if (!/^[a-f0-9]{12,64}$/.test(minio)) throw new Error('Missing restore object store');
    psql(recoveryProject, sql);
    docker(['run', '--rm', '-i', '--network', 'none', '--volumes-from', minio, '--entrypoint', 'tar', imageIds.db, 'xzf', '-', '-C', '/data'], archive);
    stage = 'restored-row-verification';
    const after = snapshot(recoveryProject);
    if (before !== after) throw new Error('Restored business row identities or counts differ');
    report.businessTables = before.split('\n').map(line => { const [table, count] = line.split('|'); return { table, count: Number(count) }; });
    checks.push({ name: 'business-row-counts-and-identities', status: 'passed' });
    stage = 'restored-api-and-image-verification';
    restore('up', '-d', 'minio');
    // Scratch MinIO has no healthcheck executable. Probe using the exact API image
    // before application initialization can attempt to create its bucket.
    restore('run', '--rm', '--no-deps', '--entrypoint', 'node', 'api', '-e',
      "(async()=>{for(let i=0;i<60;i++){try{const r=await fetch('http://minio:9000/minio/health/ready',{signal:AbortSignal.timeout(2000)});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)})()");
    restore('up', '-d', '--wait', '--wait-timeout', '180', 'api', 'web');
    for (const name of services) {
      const id = restore('ps', '-q', name).trim();
      if (docker(['inspect', '--format', '{{.Image}}', id]).trim() !== imageIds[name]) throw new Error('Restore image differs');
    }
    checks.push({ name: 'exact-running-image-reuse', status: 'passed' });
    const recoveredFiles = probe(recoveryProject);
    if (JSON.stringify(sourceFiles) !== JSON.stringify(recoveredFiles)) throw new Error('Recovered upload identity differs');
    report.verifiedFileCount = recoveredFiles.files.length;
    report.objectEvidenceDigest = createHash('sha256').update(JSON.stringify(recoveredFiles)).digest('hex');
    checks.push({ name: 'restored-api-login-and-upload-bytes', status: 'passed' });
    if (before !== snapshot(sourceProject)) throw new Error('Source business rows changed');
    checks.push({ name: 'source-preserved', status: 'passed' });
    report.status = 'passed';
  } catch (error) {
    // No raw Docker output, SQL, environment, signed URLs, tokens or archive content.
    checks.push({ name: stage, status: 'failed', reason: 'Recovery verification failed; inspect the failed stage without publishing private data.' });
    throw error;
  } finally {
    try { if (allocated) restore('down', '-v', '--remove-orphans'); }
    catch (error) { report.status = 'failed'; checks.push({ name: 'restore-cleanup', status: 'failed' }); throw error; }
    finally { rmSync(recoveryDir, { recursive: true, force: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
  }
  return report;
}
