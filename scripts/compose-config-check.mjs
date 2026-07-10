#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const checks = [
  {
    name: 'dev',
    file: 'docker-compose.yml',
  },
  {
    name: 'easy',
    file: 'docker-compose.easy.yml',
  },
  {
    name: 'ha-lite',
    file: 'docker-compose.ha-lite.yml',
  },
  {
    name: 'prod',
    file: 'docker-compose.prod.yml',
    env: {
      IMAGE_PREFIX: 'test/oneerp',
      IMAGE_TAG: 'test',
    },
  },
  {
    name: 'prod-2gb-uat',
    files: ['docker-compose.prod.yml', 'docker-compose.test-2gb.yml'],
    env: {
      IMAGE_PREFIX: 'test/oneerp',
      IMAGE_TAG: 'test',
    },
  },
];

const requiredEnv = {
  POSTGRES_PASSWORD: 'compose-test-postgres',
  JWT_SECRET: 'compose-test-jwt-secret',
  MINIO_SECRET_KEY: 'compose-test-minio-secret',
  INIT_ADMIN_EMAIL: 'admin@example.com',
  INIT_ADMIN_PASSWORD: 'compose-test-admin-password',
  CORS_ORIGINS: 'http://localhost:3000',
};

const validateManifests = process.argv.includes('--manifests');
const literalRuntimeImages = new Set();
const apiRequiredEnv = [
  'JWT_SECRET',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'CORS_ORIGINS',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
];

function runComposeConfig(check) {
  const env = {
    ...process.env,
    ...requiredEnv,
    ...(check.env ?? {}),
  };

  const files = check.files ?? [check.file];
  const composeArgs = files.flatMap((file) => ['-f', file]);
  console.log(`Checking ${files.join(' + ')} (${check.name})`);
  const result = spawnSync(
    'docker',
    ['compose', ...composeArgs, 'config', '--quiet'],
    { stdio: 'inherit', env },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${files.join(' + ')} failed docker compose config`);
  }
}

for (const check of checks) {
  runComposeConfig(check);
  assertApiRequiredEnvironment(check);
  for (const file of check.files ?? [check.file]) {
    assertNoLiteralLatestImages(file);
  }
}

if (validateManifests) {
  validateRuntimeImageManifests();
}

console.log('All Docker Compose files parsed successfully.');
console.log('No literal :latest runtime images detected.');

function assertNoLiteralLatestImages(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const findings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*image:\s*(\S+)/);
    if (!match) continue;

    const image = match[1].replace(/^["']|["']$/g, '');
    if (!image.includes('${')) {
      literalRuntimeImages.add(image);
    }
    if (image.includes('${IMAGE_TAG:-latest}')) {
      continue;
    }
    if (image.endsWith(':latest')) {
      findings.push(`${file}:${index + 1} ${image}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Docker Compose files must not use literal :latest runtime images:\n${findings.join('\n')}`,
    );
  }
}

function validateRuntimeImageManifests() {
  for (const image of [...literalRuntimeImages].sort()) {
    console.log(`Checking runtime image manifest ${image}`);
    let result;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      result = spawnSync('docker', ['manifest', 'inspect', image], {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      if (result.error) {
        throw result.error;
      }
      if (result.status === 0) break;
      console.warn(
        `Manifest check attempt ${attempt}/3 failed for ${image}: ${result.stderr.trim()}`,
      );
    }

    if (result?.status !== 0) {
      throw new Error(`Runtime image manifest is unavailable: ${image}`);
    }
  }

  console.log('All literal runtime image manifests are available.');
}

function assertApiRequiredEnvironment(check) {
  const env = {
    ...process.env,
    ...requiredEnv,
    ...(check.env ?? {}),
  };
  const files = check.files ?? [check.file];
  const composeArgs = files.flatMap((file) => ['-f', file]);
  const result = spawnSync(
    'docker',
    ['compose', ...composeArgs, 'config', '--format', 'json'],
    { encoding: 'utf8', env },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${files.join(' + ')} failed rendered config inspection`);
  }

  const api = JSON.parse(result.stdout).services?.api;
  if (!api) return;

  const missing = apiRequiredEnv.filter(
    (name) => !api.environment?.[name]?.toString().trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `${files.join(' + ')} does not forward required API environment variables: ${missing.join(', ')}`,
    );
  }
}
