import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIC_CHECK_DATABASE_URL,
  resolveStaticDatabaseUrl,
} from './prisma-static-check.mjs';

test('uses a non-production placeholder when DATABASE_URL is missing', () => {
  assert.equal(resolveStaticDatabaseUrl({}), STATIC_CHECK_DATABASE_URL);
});

test('preserves an explicitly configured DATABASE_URL', () => {
  const configured = 'postgresql://configured:secret@db.example.test:5432/oneerp';

  assert.equal(
    resolveStaticDatabaseUrl({ DATABASE_URL: configured }),
    configured,
  );
});
