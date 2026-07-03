#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
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
}

console.log('All Docker Compose files parsed successfully.');
