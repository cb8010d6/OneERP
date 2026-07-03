#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'apps/api/prisma/schema.prisma');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const [rawKey, inlineValue] = item.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function sqlIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractDefault(tail) {
  const defaultMatch = tail.match(/@default\(([^)]+)\)/);
  if (!defaultMatch) return null;
  return defaultMatch[1].replace(/^"|"$/g, '');
}

function extractAllowedValues(comment, fallbackDefault) {
  const values = new Set();
  for (const match of comment.matchAll(/\b[A-Z][A-Z0-9_]*\b/g)) {
    values.add(match[0]);
  }
  if (values.size === 0 && fallbackDefault) {
    values.add(fallbackDefault);
  }
  return [...values];
}

function inspectEnumCandidates() {
  const lines = readFileSync(schemaPath, 'utf8').split(/\r?\n/);
  const candidates = [];
  let currentModel = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    const modelMatch = line.match(/^model\s+(\w+)\s+\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      continue;
    }
    if (line.startsWith('}')) {
      currentModel = '';
      continue;
    }
    if (!currentModel) continue;

    const fieldMatch = line.match(/^\s*(\w+)\s+([A-Za-z][\w?]*)\b(.*)$/);
    if (!fieldMatch) continue;
    const [, field, rawType, tail] = fieldMatch;
    const type = rawType.replace(/\?$/, '');
    if ((field !== 'status' && field !== 'type') || type !== 'String') continue;

    const comment = line.includes('//') ? line.slice(line.indexOf('//') + 2).trim() : '';
    const defaultValue = extractDefault(tail);
    const allowedValues = extractAllowedValues(comment, defaultValue);

    candidates.push({
      model: currentModel,
      table: currentModel,
      field,
      line: lineNo,
      comment,
      defaultValue,
      allowedValues,
      allowedSource: comment ? 'comment' : defaultValue ? 'default' : 'missing',
    });
  }

  return candidates;
}

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
