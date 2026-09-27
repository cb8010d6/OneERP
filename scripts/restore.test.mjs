import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']).status === 0;
const helper = 'alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
const sql = Buffer.from("SELECT '中文 café';\n", 'utf8');
const archive = Buffer.from([31, 139, 0, 255, 128, 10, 0, 42]);

// All Docker calls are replaced by this executable; these tests never access a daemon.
const fakeDocker = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let kind = args.includes('ps') ? 'lookup' : args.includes('tzf') ? 'preflight' : args.includes('xzf') ? 'extract' : args.includes('cp') ? 'copy' : args.includes('rm') ? 'cleanup' : 'sql';
let input;
if (args.includes('-i') || (kind === 'sql' && !args.at(-1).startsWith('/tmp/'))) input = fs.readFileSync(0).toString('base64');
if (kind === 'copy') input = fs.readFileSync(args[args.indexOf('cp') + 1]).toString('base64');
const mount = args.indexOf('--mount');
if (mount >= 0) input = fs.readFileSync(args[mount + 1].slice('type=bind,source='.length).split(',destination=')[0] + '/minio-data.tgz').toString('base64');
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({args, kind, input}) + '\\n');
if (process.env.FAKE_FAIL === kind) process.exit(29);
if (kind === 'lookup') process.stdout.write(process.env.FAKE_CONTAINER ?? 'minio123\\n');
`;

function run(flavor, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oneerp restore '));
  try {
    const bin = path.join(dir, 'bin');
    const backup = path.join(dir, 'backup 中文');
    const log = path.join(dir, 'calls.jsonl');
    mkdirSync(bin); mkdirSync(backup);
    writeFileSync(path.join(bin, 'docker'), fakeDocker, { mode: 0o755 });
    if (!options.missingSql) writeFileSync(path.join(backup, 'postgres.sql'), sql);
    if (!options.noArchive) writeFileSync(path.join(backup, 'minio-data.tgz'), archive);
    writeFileSync(log, '');
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG: log,
      FAKE_FAIL: options.fail ?? '', COMPOSE_FILE: 'custom compose.yml' };
    delete env.BACKUP_HELPER_IMAGE; delete env.ONEERP_BACKUP_HELPER_IMAGE;
    if (options.container !== undefined) env.FAKE_CONTAINER = options.container;
    if (options.helper) env[flavor === 'sh' ? 'BACKUP_HELPER_IMAGE' : 'ONEERP_BACKUP_HELPER_IMAGE'] = options.helper;
    const command = flavor === 'sh' ? 'sh' : 'pwsh';
    const args = flavor === 'sh' ? [path.join(root, 'scripts/restore.sh'), backup]
      : ['-NoProfile', '-File', path.join(root, 'scripts/restore.ps1'), '-BackupDir', backup, '-ComposeFile', 'custom compose.yml'];
    const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { ...result, calls };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const flavor of ['sh', 'pwsh']) {
  test(`${flavor}: manual restore uses helper and preserves bytes`, { skip: flavor === 'pwsh' && !pwsh }, () => {
    const result = run(flavor);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Restore complete/);
    const { calls } = result;
    assert.deepEqual(calls.map(c => c.kind), flavor === 'sh'
      ? ['lookup', 'preflight', 'sql', 'extract'] : ['lookup', 'preflight', 'copy', 'sql', 'cleanup', 'extract']);
    for (const call of calls.filter(c => ['preflight', 'extract'].includes(c.kind))) {
      assert.ok(call.args.includes(helper));
      assert.equal(call.input, archive.toString('base64'));
      assert.equal(call.args.includes('--volumes-from'), call.kind === 'extract');
    }
    assert.equal(calls.find(c => c.kind === (flavor === 'sh' ? 'sql' : 'copy')).input, sql.toString('base64'));
    assert.ok(calls.find(c => c.kind === 'sql').args.some(a => a.includes('ON_ERROR_STOP=1')));
    for (const call of calls.filter(c => c.args[0] === 'compose')) {
      assert.equal(call.args[call.args.indexOf('-f') + 1], 'custom compose.yml');
      assert.ok(!call.args.includes('minio:/tmp/minio-data.tgz'));
      assert.ok(!(call.args.includes('exec') && call.args.includes('minio')));
    }
  });
  test(`${flavor}: preflight and restore failures stop further writes`, { skip: flavor === 'pwsh' && !pwsh }, () => {
    for (const fail of ['lookup', 'preflight', 'sql', 'extract', ...(flavor === 'pwsh' ? ['copy', 'cleanup'] : [])]) {
      const result = run(flavor, { fail });
      assert.notEqual(result.status, 0, fail);
      assert.doesNotMatch(result.stdout, /Restore complete/, fail);
      if (['lookup', 'preflight'].includes(fail)) assert.ok(!result.calls.some(c => c.kind === 'sql'));
      if (fail !== 'extract') assert.ok(!result.calls.some(c => c.kind === 'extract'));
    }
    for (const container of ['', 'one\ntwo\n']) {
      const result = run(flavor, { container });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls.map(c => c.kind), ['lookup']);
    }
  });
  test(`${flavor}: SQL required, MinIO optional, helper configurable`, { skip: flavor === 'pwsh' && !pwsh }, () => {
    const missing = run(flavor, { missingSql: true });
    assert.notEqual(missing.status, 0); assert.equal(missing.calls.length, 0);
    const optional = run(flavor, { noArchive: true });
    assert.equal(optional.status, 0, optional.stderr);
    assert.ok(!optional.calls.some(c => ['lookup', 'preflight', 'extract'].includes(c.kind)));
    const override = run(flavor, { helper: 'operator/helper:tested' });
    assert.equal(override.status, 0, override.stderr);
    assert.ok(override.calls.filter(c => ['preflight', 'extract'].includes(c.kind)).every(c => c.args.includes('operator/helper:tested')));
  });
}
