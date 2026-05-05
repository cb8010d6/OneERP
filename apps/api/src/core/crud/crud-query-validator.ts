import { BadRequestException } from '@nestjs/common';

/**
 * Maximum allowed include nesting depth.
 * E.g. { items: { order: { partner: true } } } has depth 3.
 */
const MAX_INCLUDE_DEPTH = 2;

/**
 * Prisma DMMF model metadata (subset we care about).
 */
export interface DmmfFieldMeta {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isList: boolean;
  relationName?: string;
}

export interface DmmfModelMeta {
  name: string;
  fields: DmmfFieldMeta[];
}

interface RuntimeDataModel {
  models: Record<string, DmmfModelMeta>;
}

/**
 * Extract DMMF from a PrismaClient instance.
 * Works with Prisma 5.x internal `_runtimeDataModel`.
 */
export function getDmmfModel(
  prismaClient: unknown,
  modelName: string,
): DmmfModelMeta | undefined {
  try {
    const rdm = (prismaClient as { _runtimeDataModel?: RuntimeDataModel })
      ._runtimeDataModel;
    return rdm?.models?.[modelName];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Include sanitization
// ---------------------------------------------------------------------------

export function sanitizeInclude(
  include: Record<string, unknown> | undefined,
  modelMeta: DmmfModelMeta | undefined,
  currentDepth = 1,
): Record<string, unknown> | undefined {
  if (!include || typeof include !== 'object') return undefined;

  if (currentDepth > MAX_INCLUDE_DEPTH) {
    throw new BadRequestException(
      `include 嵌套深度超过限制（最大 ${MAX_INCLUDE_DEPTH} 层）`,
    );
  }

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(include)) {
    if (modelMeta) {
      const field = modelMeta.fields.find((f) => f.name === key);
      if (!field) {
        throw new BadRequestException(
          `include 字段 "${key}" 在模型 "${modelMeta.name}" 中不存在`,
        );
      }
      if (field.kind !== 'object') {
        throw new BadRequestException(
          `include 字段 "${key}" 不是关联字段，不能 include`,
        );
      }
    }

    const value = include[key];

    if (value === true || value === false) {
      result[key] = value;
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const valueObj = value as Record<string, unknown>;
      if (valueObj.include && typeof valueObj.include === 'object') {
        const relatedModelMeta = resolveRelatedModelMeta(modelMeta, key);
        result[key] = {
          ...valueObj,
          include: sanitizeInclude(
            valueObj.include as Record<string, unknown>,
            relatedModelMeta,
            currentDepth + 1,
          ),
        };
        continue;
      }
      result[key] = valueObj;
      continue;
    }

    result[key] = value;
  }

  return result;
}

function resolveRelatedModelMeta(
  modelMeta: DmmfModelMeta | undefined,
  relationFieldName: string,
): DmmfModelMeta | undefined {
  if (!modelMeta) return undefined;
  const field = modelMeta.fields.find((f) => f.name === relationFieldName);
  if (!field || field.kind !== 'object') return undefined;
  return undefined;
}

// ---------------------------------------------------------------------------
// Filter sanitization
// ---------------------------------------------------------------------------

const PRISMA_LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT']);

export function sanitizeFilter(
  filter: Record<string, unknown>,
  modelMeta: DmmfModelMeta | undefined,
): Record<string, unknown> {
  if (!filter || typeof filter !== 'object') return {};
  if (!modelMeta) return filter;

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(filter)) {
    if (PRISMA_LOGICAL_OPERATORS.has(key)) {
      const value = filter[key];
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? sanitizeFilter(item as Record<string, unknown>, modelMeta)
            : item,
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeFilter(
          value as Record<string, unknown>,
          modelMeta,
        );
      } else {
        result[key] = value;
      }
      continue;
    }

    const field = modelMeta.fields.find((f) => f.name === key);

    if (!field) {
      throw new BadRequestException(
        `filter 字段 "${key}" 在模型 "${modelMeta.name}" 中不存在`,
      );
    }

    if (field.kind === 'scalar' || field.kind === 'enum') {
      result[key] = filter[key];
      continue;
    }

    if (field.kind === 'object') {
      const value = filter[key];
      if (typeof value === 'object' && value !== null) {
        result[key] = value;
      } else {
        throw new BadRequestException(
          `filter 字段 "${key}" 是关联字段，值必须是对象`,
        );
      }
      continue;
    }

    throw new BadRequestException(
      `filter 字段 "${key}" 类型 "${field.kind}" 不支持`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// OrderBy sanitization
// ---------------------------------------------------------------------------

export function sanitizeOrderBy(
  orderBy:
    | Record<string, 'asc' | 'desc'>
    | Record<string, 'asc' | 'desc'>[]
    | undefined,
  modelMeta: DmmfModelMeta | undefined,
):
  | Record<string, 'asc' | 'desc'>
  | Record<string, 'asc' | 'desc'>[]
  | undefined {
  if (!orderBy) return undefined;
  if (!modelMeta) return orderBy;

  const validateOne = (
    item: Record<string, 'asc' | 'desc'>,
  ): Record<string, 'asc' | 'desc'> => {
    const result: Record<string, 'asc' | 'desc'> = {};
    for (const key of Object.keys(item)) {
      const field = modelMeta.fields.find((f) => f.name === key);
      if (!field) {
        throw new BadRequestException(
          `orderBy 字段 "${key}" 在模型 "${modelMeta.name}" 中不存在`,
        );
      }
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        throw new BadRequestException(
          `orderBy 字段 "${key}" 是关联字段，不允许按关联字段排序`,
        );
      }
      result[key] = item[key];
    }
    return result;
  };

  if (Array.isArray(orderBy)) {
    return orderBy.map(validateOne);
  }

  return validateOne(orderBy);
}
