import { BadRequestException } from '@nestjs/common';

export type JsonValue =
  | Record<string, unknown>
  | JsonValue[]
  | string
  | number
  | boolean
  | null;

export function parseJsonParam<T = unknown>(
  value?: unknown,
  options?: { allowCommaList?: boolean },
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return value as T;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (options?.allowCommaList && trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean) as T;
    }
    throw new BadRequestException('无效的 JSON 参数');
  }
}

export function normalizeSelect(
  fields?: unknown,
): Record<string, boolean> | undefined {
  if (!fields) return undefined;
  if (Array.isArray(fields)) {
    return fields.reduce<Record<string, boolean>>((acc, field) => {
      if (field) acc[String(field)] = true;
      return acc;
    }, {});
  }
  if (typeof fields === 'object') return fields as Record<string, boolean>;
  return undefined;
}

export function parseOrderByParam(
  value?: unknown,
):
  | Record<string, 'asc' | 'desc'>
  | Record<string, 'asc' | 'desc'>[]
  | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return parseOrderByString(trimmed);
    }
  }

  const parsed = parseJsonParam<unknown>(value);
  if (!parsed) return undefined;

  if (Array.isArray(parsed) || typeof parsed === 'object') {
    return parsed as
      | Record<string, 'asc' | 'desc'>
      | Record<string, 'asc' | 'desc'>[];
  }

  if (typeof parsed === 'string') {
    return parseOrderByString(parsed);
  }

  return undefined;
}

function parseOrderByString(value: string): Record<string, 'asc' | 'desc'>[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items.length) return [];

  return items.map((item) => {
    const [field, rawDirection] = item.split(':').map((part) => part.trim());
    if (!field) {
      throw new BadRequestException('无效的 orderBy 参数');
    }

    const direction = rawDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    return { [field]: direction };
  });
}
