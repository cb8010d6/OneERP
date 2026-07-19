#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');

function buildDistributionQuery(candidate) {
  const table = sqlIdentifier(candidate.table);
  const field = sqlIdentifier(candidate.field);
  return `SELECT ${field} AS value, COUNT(*)::text AS "rowCount"
FROM ${table}
GROUP BY ${field}
ORDER BY COUNT(*) DESC, ${field};`;
}

function buildInvalidValueQuery(candidate) {
  const table = sqlIdentifier(candidate.table);
  const field = sqlIdentifier(candidate.field);
  const values = candidate.allowedValues.map(sqlString).join(', ');
  return `SELECT ${field} AS "invalidValue", COUNT(*)::text AS "rowCount"
FROM ${table}
WHERE ${field} IS NULL OR ${field} NOT IN (${values})
GROUP BY ${field}
ORDER BY COUNT(*) DESC, ${field};`;
}

function sumRows(rows) {
  return rows.reduce((total, row) => total + BigInt(row.rowCount), 0n);
}

async function inspectDatabase(tx, candidates) {
  const results = [];

  for (const candidate of candidates) {
    const distribution = await tx.$queryRawUnsafe(buildDistributionQuery(candidate));
    const invalidValues =
      candidate.allowedValues.length > 0
        ? await tx.$queryRawUnsafe(buildInvalidValueQuery(candidate))
        : [];
    const invalidRowCount = sumRows(invalidValues);

    results.push({
      model: candidate.model,
      table: candidate.table,
      field: candidate.field,
      line: candidate.line,
      path: relative(schemaPath),
      comment: candidate.comment,
      defaultValue: candidate.defaultValue,
      allowedSource: candidate.allowedSource,
      allowedValues: candidate.allowedValues,
      distribution,
      invalidValues,
      invalidRowCount: invalidRowCount.toString(),
      needsAllowedValueConfirmation: candidate.allowedSource !== 'comment',
      cleanForEnumMigration: candidate.allowedValues.length > 0 && invalidRowCount === 0n,
    });
  }

  return results;
}

function buildSummary(candidates, results) {
  const invalidRows = results.reduce(
    (total, result) => total + BigInt(result.invalidRowCount),
    0n,
  );
  return {
    candidateFields: candidates.length,
    fieldsWithInvalidValues: results.filter((result) => BigInt(result.invalidRowCount) > 0n).length,
    invalidRows: invalidRows.toString(),
    fieldsNeedingAllowedValueConfirmation: results.filter(
      (result) => result.needsAllowedValueConfirmation,
    ).length,
    fieldsCleanForEnumMigration: results.filter((result) => result.cleanForEnumMigration).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(
    root,
    args.report || process.env.ENUM_DIRTY_DATA_REPORT || 'enum-dirty-data-report.json',
  );

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to run the enum dirty-data report.');
    console.error('The report is read-only and does not modify the database.');
    process.exitCode = 1;
    return;
  }

  const candidates = inspectEnumCandidates();
  const prisma = new PrismaClient();

  try {
    const results = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return inspectDatabase(tx, candidates);
    });

    const report = {
      generatedAt: new Date().toISOString(),
      schemaPath: relative(schemaPath),
      databaseUrlConfigured: true,
      readOnlyTransaction: true,
      candidates: results,
      summary: buildSummary(candidates, results),
    };

    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`Enum dirty-data report written to ${relative(reportPath)}`);
    console.log(`${report.summary.candidateFields} status/type String candidates inspected.`);
    console.log(`${report.summary.fieldsWithInvalidValues} fields contain invalid values.`);
    console.log(`${report.summary.invalidRows} invalid rows detected.`);
    if (report.summary.fieldsNeedingAllowedValueConfirmation > 0) {
      console.log(
        `${report.summary.fieldsNeedingAllowedValueConfirmation} fields need allowed-value confirmation before enum migration.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
