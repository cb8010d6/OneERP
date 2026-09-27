import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertRecoveryScope, isolatedConfig, runRecovery, recoveryProbeCode } from './recovery-rehearsal.mjs';
const scope = { sourceProject: 'oneerp-ci-abc', recoveryProject: 'oneerp-ci-abc-restore' };
const env = { CI: 'true', GITHUB_ACTIONS: 'true', ONEERP_CONTAINER_REHEARSAL: '1' };
const digest = `sha256:${'a'.repeat(64)}`;
const names = ['db', 'redis', 'minio', 'api', 'web'];
const images = Object.fromEntries(names.map(n => [n, digest]));
const config = { services: Object.fromEntries(names.map(n => [n, { image: 'mutable:tag', ports: ['8000:8000'], depends_on: { migrate: {} }, volumes: n === 'db' ? [{ type: 'volume', source: 'data', target: '/data' }] : [] }])), volumes: { data: { name: 'source_data' } } };
test('scope fails closed outside explicit isolated GitHub CI', () => {
  assert.doesNotThrow(() => assertRecoveryScope(scope, env));
  for (const key of Object.keys(env)) assert.throws(() => assertRecoveryScope(scope, { ...env, [key]: '' }));
  assert.throws(() => assertRecoveryScope({ ...scope, recoveryProject: scope.sourceProject }, env));
  assert.throws(() => assertRecoveryScope({ sourceProject: 'production', recoveryProject: 'production-restore' }, env));
});
test('derived stack pins exact images, fresh volumes, no migration or exposed ports', () => {
  const isolated = isolatedConfig(config, images);
  assert.deepEqual(isolated.volumes, { data: {} });
  for (const service of Object.values(isolated.services)) {
    assert.equal(service.image, digest); assert.equal(service.pull_policy, 'never');
    assert.equal(service.ports, undefined); assert.equal(service.depends_on, undefined);
  }
  assert.equal(isolated.services.migrate, undefined);
  const unsafe = structuredClone(config); unsafe.volumes.data.external = true;
  assert.throws(() => isolatedConfig(unsafe, images));
  unsafe.volumes.data.external = false; unsafe.services.db.volumes[0].type = 'bind';
  assert.throws(() => isolatedConfig(unsafe, images));
  assert.throws(() => isolatedConfig(config, { ...images, api: 'mutable:tag' }));
});
test('SQL failure halts before API start and cleans only restore project', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'recovery-mock-'));
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const log = path.join(dir, 'calls.jsonl');
  const report = path.join(dir, 'report.json');
  const mock = `#!/usr/bin/env -S node --
const fs=require('node:fs'); const a=process.argv.slice(2); const input=fs.readFileSync(0,'utf8');
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({a,input})+'\\n');
if(a[0]==='container'||a[0]==='volume') process.exit(0);
if(a.includes('config')) process.stdout.write(${JSON.stringify(JSON.stringify(config))});
else if(a[0]==='inspect') console.log(${JSON.stringify(digest)});
else if(a.includes('ps')) console.log('aaaaaaaaaaaa');
else if(a.includes('node')) console.log(JSON.stringify({files:[{id:'file',checksumSha256:'checksum'}]}));
else if(a.some(x=>x.includes('pg_dump'))) console.log('SQL PRIVATE');
else if(a.includes('czf')) process.stdout.write('archive');
else if(a.some(x=>x.includes('psql'))) {
 if(input.includes('SELECT count(*) FROM')) { console.log('0'); process.exit(0); }
 if(a.includes('oneerp-ci-abc-restore') && input.includes('SQL PRIVATE')) process.exit(3);
 console.log('EngineeringDocumentRevision|1|fingerprint');
}
`;
  writeFileSync(path.join(dir, 'docker'), mock, { mode: 0o700 });
  try {
    await assert.rejects(runRecovery({ ...scope, root: dir, composeFile: '/mock/source.json', envFile: '/mock/ci.env', tempDir: dir, reportPath: report, credentials: { email: 'ci@example.test', password: 'secret-password-sentinel' }, dockerEnv: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_LOG: log } }));
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const sqlRestore = calls.find(c => c.a.includes(scope.recoveryProject) && c.input.includes('SQL PRIVATE'));
    assert.ok(sqlRestore.a.some(x => x.includes('ON_ERROR_STOP=1')));
    assert.ok(calls.some(c => c.a.includes(scope.recoveryProject) && c.a.includes('down')));
    assert.ok(!calls.some(c => c.a.includes(scope.sourceProject) && c.a.includes('down')));
    assert.ok(!calls.some(c => c.a.includes(scope.recoveryProject) && c.a.includes('up') && c.a.includes('api')));
    const saved = readFileSync(report, 'utf8'); assert.equal(JSON.parse(saved).status, 'failed');
    assert.ok(!saved.includes('SQL PRIVATE')); assert.ok(!saved.includes('secret-password-sentinel'));
  } finally { for(const [k,v] of Object.entries(old)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } rmSync(dir,{recursive:true,force:true}); }
});

test('real API probe selects exact company and supplies tenant header', () => {
  const setup = `global.fetch=async(url,options)=>{ url=String(url);
    if(url.endsWith('/auth/login')) return {ok:true,json:async()=>({accessToken:'token',companies:[{id:'synthetic-id',name:'CI Company'}]})};
    if(url.endsWith('/files')) {
      if(options.headers['x-company-id']!=='synthetic-id') throw Error('Missing tenant');
      return {ok:true,json:async()=>[{id:'file-id',checksumSha256:require('node:crypto').createHash('sha256').update('bytes').digest('hex'),downloadUrl:'http://minio:9000/object'}]};
    }
    return {ok:true,arrayBuffer:async()=>Buffer.from('bytes')};
  };`;
  const run = companyName => spawnSync(process.execPath, ['-e', setup + recoveryProbeCode], { input: JSON.stringify({email:'ci@example.test',password:'sentinel',companyName}), encoding:'utf8' });
  const passed = run('CI Company'); assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).files[0].id, 'file-id');
  assert.notEqual(run('Wrong Company').status, 0);
});
