#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'apps/api/prisma/schema.prisma');
const apiSrcRoot = path.join(root, 'apps/api/src');

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

function readLines(filePath) {
  return readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function walkFiles(dir, predicate, output = []) {
  if (!existsSync(dir)) return output;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
      walkFiles(fullPath, predicate, output);
      continue;
    }
    if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

function inspectSchema() {
  const lines = readLines(schemaPath);
  const enumCandidates = [];
  const floatFields = [];
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
    const comment = line.includes('//') ? line.slice(line.indexOf('//') + 2).trim() : '';

    if ((field === 'status' || field === 'type') && type === 'String') {
      enumCandidates.push({
        model: currentModel,
        field,
        type,
        line: lineNo,
        path: relative(schemaPath),
        default: tail.match(/@default\(([^)]+)\)/)?.[1] ?? null,
        comment,
      });
    }

    if (type === 'Float') {
      const looksLikeMoney =
        /amount|price|cost|total|tax|debit|credit|balance|rate|value/i.test(field);
      floatFields.push({
        model: currentModel,
        field,
        line: lineNo,
        path: relative(schemaPath),
        looksLikeMoney,
        declaration: line.trim(),
      });
    }
  }

  return { enumCandidates, floatFields };
}

function inspectSource() {
  const files = walkFiles(apiSrcRoot, (filePath) => filePath.endsWith('.ts'));
  const dateNowUsages = [];
  const directEventEmits = [];
  const deprecatedCompatibility = [];
  const transactionMentions = [];

  for (const filePath of files) {
    const rel = relative(filePath);
    const lines = readLines(filePath);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineNo = index + 1;
      const trimmed = line.trim();

      if (trimmed.includes('Date.now()')) {
        const category = classifyDateNowUsage(trimmed);
        dateNowUsages.push({
          path: rel,
          line: lineNo,
          category,
          snippet: trimmed,
        });
      }

      if (trimmed.includes('eventEmitter.emit(')) {
        directEventEmits.push({
          path: rel,
          line: lineNo,
          snippet: trimmed,
        });
      }

      if (trimmed.includes('$transaction')) {
        transactionMentions.push({
          path: rel,
          line: lineNo,
          snippet: trimmed,
        });
      }

      if (trimmed.includes('@deprecated')) {
        deprecatedCompatibility.push({
          path: rel,
          line: lineNo,
          snippet: trimmed,
        });
      }
    }
  }

  return {
    dateNowUsages,
    directEventEmits,
    deprecatedCompatibility,
    transactionMentions,
  };
}

function classifyDateNowUsage(snippet) {
  if (
    /(?:invoiceNo|creditNo|refundNo|purchaseNo|receiptNo|paymentNo|returnNo|workOrderNo|referenceNo|batchNo)\b/.test(
      snippet,
    ) ||
    /`(?:INV|CN|RF|WO|SCAN|BATCH|\$\{documentType\})[-$]/.test(snippet)
  ) {
    return 'business-document-number';
  }
  if (/fileName|objectName|AI客户|chat2sql/.test(snippet)) {
    return 'storage-or-export-id';
  }
  return 'time-calculation';
}

function buildRecommendations(report) {
  const enumCount = report.schema.enumCandidates.length;
  const moneyFloatCount = report.schema.floatFields.filter((field) => field.looksLikeMoney).length;
  const businessDocumentNumberCount = report.source.dateNowUsages.filter(
    (usage) => usage.category === 'business-document-number',
  ).length;
  const eventEmitCount = report.source.directEventEmits.length;

  return [
    {
      priority: 'P1',
      name: 'Prisma enum migration preflight',
      status: enumCount > 0 ? 'required' : 'clear',
      detail: `${enumCount} status/type String fields detected. Run dirty-data SQL before schema migration.`,
    },
    {
      priority: 'P1',
      name: 'Decimal migration preflight',
      status: moneyFloatCount > 0 ? 'required' : 'clear',
      detail: `${moneyFloatCount} Float fields look money-like. Confirm business precision before migration.`,
    },
    {
      priority: 'P1',
      name: 'Business number collision handling',
      status: businessDocumentNumberCount > 0 ? 'required' : 'clear',
      detail: `${businessDocumentNumberCount} Date.now() usages look like business document numbers. Add retry or sequence design.`,
    },
    {
      priority: 'P2',
      name: 'Outbox/event consistency',
      status: eventEmitCount > 0 ? 'required' : 'clear',
      detail: `${eventEmitCount} direct eventEmitter.emit calls detected. Review post-transaction failure handling.`,
    },
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(
    root,
    args.report || process.env.REMAINING_RISK_AUDIT_REPORT || 'remaining-risk-audit-report.json',
  );

  const report = {
    generatedAt: new Date().toISOString(),
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
    schema: inspectSchema(),
    source: inspectSource(),
  };
  report.summary = {
    enumCandidateFields: report.schema.enumCandidates.length,
    floatFields: report.schema.floatFields.length,
    moneyLikeFloatFields: report.schema.floatFields.filter((field) => field.looksLikeMoney).length,
    dateNowUsages: report.source.dateNowUsages.length,
    businessDocumentNumberDateNowUsages: report.source.dateNowUsages.filter(
      (usage) => usage.category === 'business-document-number',
    ).length,
    directEventEmits: report.source.directEventEmits.length,
    transactionMentions: report.source.transactionMentions.length,
    deprecatedCompatibilityMarkers: report.source.deprecatedCompatibility.length,
  };
  report.recommendations = buildRecommendations(report);

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Remaining risk audit written to ${relative(reportPath)}`);
  for (const recommendation of report.recommendations) {
    console.log(`[${recommendation.priority}] ${recommendation.name}: ${recommendation.detail}`);
  }
}

main();
