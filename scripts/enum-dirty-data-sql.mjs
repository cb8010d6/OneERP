#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  inspectEnumCandidates,
  parseArgs,
  relative,
  root,
  schemaPath,
  sqlIdentifier,
  sqlString,
} from './enum-dirty-data-common.mjs';

function buildDistributionQuery(candidate) {
  const table = sqlIdentifier(candidate.table);
  const field = sqlIdentifier(candidate.field);
  const label = sqlString(`${candidate.model}.${candidate.field}`);
  return `SELECT ${label} AS field, ${field} AS value, COUNT(*)::bigint AS row_count
FROM ${table}
GROUP BY ${field}
ORDER BY row_count DESC, value;`;
}

function buildInvalidValueQuery(candidate) {
  const table = sqlIdentifier(candidate.table);
  const field = sqlIdentifier(candidate.field);
  const label = sqlString(`${candidate.model}.${candidate.field}`);
  const values = candidate.allowedValues.map(sqlString).join(', ');
  return `SELECT ${label} AS field, ${field} AS invalid_value, COUNT(*)::bigint AS row_count
FROM ${table}
WHERE ${field} IS NULL OR ${field} NOT IN (${values})
GROUP BY ${field}
ORDER BY row_count DESC, invalid_value;`;
}

function buildSql(candidates) {
  const generatedAt = new Date().toISOString();
  const lines = [
    '-- OneERP Prisma enum migration dirty-data preflight',
    `-- Generated at: ${generatedAt}`,
    `-- Source: ${relative(schemaPath)}`,
    '-- This file is read-only SQL. It must return zero rows in every invalid-value query before enum migration.',
    '',
    'BEGIN;',
    'SET TRANSACTION READ ONLY;',
    '',
    '-- 1. Current value distribution for every status/type String candidate.',
    '',
  ];

  for (const candidate of candidates) {
    lines.push(
      `-- ${candidate.model}.${candidate.field} at ${relative(schemaPath)}:${candidate.line}`,
      buildDistributionQuery(candidate),
      '',
    );
  }

  lines.push(
    '-- 2. Invalid values against the current schema comments/defaults.',
    '-- Review candidates marked "allowed source: default" with product/business owners before migration.',
    '',
  );

  for (const candidate of candidates) {
    if (candidate.allowedValues.length === 0) {
      lines.push(
        `-- ${candidate.model}.${candidate.field}: skipped invalid-value query; no allowed values found in comment/default.`,
        '',
      );
      continue;
    }

    lines.push(
      `-- ${candidate.model}.${candidate.field}; allowed source: ${candidate.allowedSource}; allowed values: ${candidate.allowedValues.join(', ')}`,
      buildInvalidValueQuery(candidate),
      '',
    );
  }

  lines.push('ROLLBACK;', '');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(
    root,
    args.output || process.env.ENUM_DIRTY_DATA_SQL || 'enum-dirty-data-scan.sql',
  );
  const candidates = inspectEnumCandidates();
  const sql = buildSql(candidates);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sql, 'utf8');

  const defaultOnly = candidates.filter((candidate) => candidate.allowedSource === 'default').length;
  const missing = candidates.filter((candidate) => candidate.allowedSource === 'missing').length;
  console.log(`Enum dirty-data SQL written to ${relative(outputPath)}`);
  console.log(`${candidates.length} status/type String candidates included.`);
  if (defaultOnly > 0) {
    console.log(`${defaultOnly} candidates infer allowed values from @default only; confirm before migration.`);
  }
  if (missing > 0) {
    console.log(`${missing} candidates have no allowed values; only distribution SQL was generated.`);
  }
}

main();
