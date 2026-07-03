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
];

const requiredEnv = {
  POSTGRES_PASSWORD: 'compose-test-postgres',
  JWT_SECRET: 'compose-test-jwt-secret',
  MINIO_SECRET_KEY: 'compose-test-minio-secret',
  INIT_ADMIN_EMAIL: 'admin@example.com',
  INIT_ADMIN_PASSWORD: 'compose-test-admin-password',
  CORS_ORIGINS: 'http://localhost:3000',
};

function runComposeConfig(check) {
  const env = {
    ...process.env,
    ...requiredEnv,
    ...(check.env ?? {}),
  };

  console.log(`Checking ${check.file} (${check.name})`);
  const result = spawnSync(
    'docker',
    ['compose', '-f', check.file, 'config', '--quiet'],
    { stdio: 'inherit', env },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${check.file} failed docker compose config`);
  }
}

for (const check of checks) {
  runComposeConfig(check);
  assertNoLiteralLatestImages(check.file);
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
