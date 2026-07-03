import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const schemaPath = path.join(root, 'apps/api/prisma/schema.prisma');

export function parseArgs(argv) {
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

export function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

export function sqlIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function sqlString(value) {
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

export function inspectEnumCandidates() {
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
