import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertGenericModelAllowed } from './crud-access-policy';

const MAX_INCLUDE_DEPTH = 2;

export interface DmmfFieldMeta {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isList: boolean;
  relationName?: string;
  isRequired?: boolean;
  isId?: boolean;
  isUnique?: boolean;
  relationFromFields?: string[];
  relationToFields?: string[];
}

export interface DmmfModelMeta {
  name: string;
  fields: DmmfFieldMeta[];
}

interface RuntimeDataModel {
  // Prisma runtime entries do not contain their model name.
  models: Record<string, Omit<DmmfModelMeta, 'name'>>;
}

type ModelResolver = (name: string) => DmmfModelMeta | undefined;
type OrderBy =
  | Record<string, 'asc' | 'desc'>
  | Record<string, 'asc' | 'desc'>[];

export function getDmmfModel(
  prismaClient: unknown,
  modelName: string,
): DmmfModelMeta | undefined {
  const models = (
    prismaClient as { _runtimeDataModel?: RuntimeDataModel } | null
  )?._runtimeDataModel?.models;
  if (!models) return undefined;
  // Prisma uses UpperCamel model names and lowerCamel delegate names.
  const name = Object.keys(models).find(
    (key) =>
      key === modelName ||
      key.charAt(0).toLowerCase() + key.slice(1) === modelName,
  );
  return name ? { ...models[name], name } : undefined;
}

function requireModel(model: DmmfModelMeta | undefined): DmmfModelMeta {
  if (!model) throw new BadRequestException('无法验证模型元数据');
  assertGenericModelAllowed(model.name);
  return model;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function getField(model: DmmfModelMeta, name: string): DmmfFieldMeta {
  const field = model.fields.find((item) => item.name === name);
  if (!field) {
    throw new BadRequestException(
      `字段 "${name}" 在模型 "${model.name}" 中不存在`,
    );
  }
  return field;
}

function relatedModel(
  field: DmmfFieldMeta,
  resolve?: ModelResolver,
): DmmfModelMeta {
  assertGenericModelAllowed(field.type);
  return requireModel(resolve?.(field.type));
}

export function sanitizeInclude(
  include: Record<string, unknown> | undefined,
  modelMeta: DmmfModelMeta | undefined,
  resolve?: ModelResolver,
  depth = 1,
): Record<string, unknown> | undefined {
  return sanitizeProjection(include, modelMeta, 'include', resolve, depth);
}

export function sanitizeSelect(
  select: Record<string, unknown> | undefined,
  modelMeta: DmmfModelMeta | undefined,
  resolve?: ModelResolver,
): Record<string, unknown> | undefined {
  return sanitizeProjection(select, modelMeta, 'select', resolve, 1);
}

function sanitizeProjection(
  projection: Record<string, unknown> | undefined,
  modelMeta: DmmfModelMeta | undefined,
  kind: 'include' | 'select',
  resolve: ModelResolver | undefined,
  depth: number,
): Record<string, unknown> | undefined {
  if (projection === undefined) return undefined;
  const model = requireModel(modelMeta);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asObject(projection, kind))) {
    if (key === '_count') {
      result[key] = sanitizeCount(value, model, resolve);
      continue;
    }
    const field = getField(model, key);
    if (field.kind !== 'object') {
      if (kind !== 'select' || typeof value !== 'boolean') {
        throw new BadRequestException(`字段 "${key}" 不是可选关联字段`);
      }
      result[key] = value;
      continue;
    }
    if (value === false) {
      result[key] = false;
      continue;
    }
    assertGenericModelAllowed(field.type);
    if (depth > MAX_INCLUDE_DEPTH) {
      throw new BadRequestException(
        `关联查询嵌套深度超过限制（最大 ${MAX_INCLUDE_DEPTH} 层）`,
      );
    }
    result[key] =
      value === true
        ? true
        : sanitizeRelationArgs(
            asObject(value, key),
            relatedModel(field, resolve),
            resolve,
            depth,
          );
  }
  return result;
}

function sanitizeRelationArgs(
  args: Record<string, unknown>,
  model: DmmfModelMeta,
  resolve: ModelResolver | undefined,
  depth: number,
): Record<string, unknown> {
  if (args.select !== undefined && args.include !== undefined) {
    throw new BadRequestException('select 和 include 不能同时使用');
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'select' || key === 'include') {
      result[key] = sanitizeProjection(
        asObject(value, key),
        model,
        key,
        resolve,
        depth + 1,
      );
    } else if (key === 'cursor') {
      // A foreign cursor can change pagination even when output rows are scoped.
      throw new BadRequestException('关联查询不支持 cursor');
    } else if (key === 'where') {
      result[key] = sanitizeFilter(asObject(value, key), model, resolve);
    } else if (key === 'orderBy') {
      result[key] = sanitizeOrderBy(value as OrderBy, model);
    } else if (key === 'take' || key === 'skip') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new BadRequestException(`${key} 必须是整数`);
      }
      result[key] = value;
    } else if (key === 'distinct') {
      const names = Array.isArray(value) ? value : [value];
      for (const name of names) {
        if (
          typeof name !== 'string' ||
          getField(model, name).kind === 'object'
        ) {
          throw new BadRequestException('distinct 仅支持标量字段');
        }
      }
      result[key] = value;
    } else {
      throw new BadRequestException(`不支持关联查询参数 "${key}"`);
    }
  }
  return result;
}

function sanitizeCount(
  value: unknown,
  model: DmmfModelMeta,
  resolve?: ModelResolver,
): unknown {
  if (value === false) return false;
  if (value === true) {
    for (const field of model.fields.filter(
      (item) => item.kind === 'object' && item.isList,
    )) {
      assertGenericModelAllowed(field.type);
    }
    return true;
  }
  const args = asObject(value, '_count');
  if (Object.keys(args).some((key) => key !== 'select')) {
    throw new BadRequestException('_count 仅支持 select');
  }
  const select = asObject(args.select, '_count.select');
  const result: Record<string, unknown> = {};
  for (const [key, selection] of Object.entries(select)) {
    const field = getField(model, key);
    if (field.kind !== 'object' || !field.isList) {
      throw new BadRequestException('_count 仅支持列表关联字段');
    }
    if (selection === false) {
      result[key] = false;
      continue;
    }
    assertGenericModelAllowed(field.type);
    if (selection === true) {
      result[key] = true;
      continue;
    }
    const options = asObject(selection, '_count.select');
    if (Object.keys(options).some((option) => option !== 'where')) {
      throw new BadRequestException('_count 关联仅支持 where');
    }
    result[key] = {
      where: sanitizeFilter(
        asObject(options.where, 'where'),
        relatedModel(field, resolve),
        resolve,
      ),
    };
  }
  return { select: result };
}

const LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT']);

export function sanitizeFilter(
  filter: Record<string, unknown>,
  modelMeta: DmmfModelMeta | undefined,
  resolve?: ModelResolver,
): Record<string, unknown> {
  const model = requireModel(modelMeta);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asObject(filter, 'filter'))) {
    if (LOGICAL_OPERATORS.has(key)) {
      result[key] = Array.isArray(value)
        ? value.map((item) =>
            sanitizeFilter(asObject(item, key), model, resolve),
          )
        : sanitizeFilter(asObject(value, key), model, resolve);
      continue;
    }
    const field = getField(model, key);
    if (field.kind === 'object') {
      const related = relatedModel(field, resolve);
      if (value === null && !field.isList) {
        result[key] = null;
        continue;
      }
      const relationFilter = asObject(value, key);
      const operators = field.isList
        ? ['some', 'every', 'none']
        : ['is', 'isNot'];
      if (
        Object.keys(relationFilter).some((operator) =>
          operators.includes(operator),
        )
      ) {
        const sanitized: Record<string, unknown> = {};
        for (const [operator, nested] of Object.entries(relationFilter)) {
          if (!operators.includes(operator))
            throw new BadRequestException('无效的关联过滤条件');
          sanitized[operator] =
            nested === null && !field.isList
              ? null
              : sanitizeFilter(asObject(nested, operator), related, resolve);
        }
        result[key] = sanitized;
      } else {
        result[key] = sanitizeFilter(relationFilter, related, resolve);
      }
    } else if (field.kind === 'scalar' || field.kind === 'enum') {
      result[key] = value;
    } else {
      throw new BadRequestException(`filter 字段 "${key}" 类型不支持`);
    }
  }
  return result;
}

export function sanitizeOrderBy(
  orderBy: OrderBy | undefined,
  modelMeta: DmmfModelMeta | undefined,
): OrderBy | undefined {
  if (orderBy === undefined) return undefined;
  const model = requireModel(modelMeta);
  const validateOne = (item: unknown): Record<string, 'asc' | 'desc'> => {
    const result: Record<string, 'asc' | 'desc'> = {};
    for (const [key, value] of Object.entries(asObject(item, 'orderBy'))) {
      const field = getField(model, key);
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        throw new BadRequestException(
          `orderBy 字段 "${key}" 不允许按关联字段排序`,
        );
      }
      if (value !== 'asc' && value !== 'desc')
        throw new BadRequestException('无效的排序方向');
      result[key] = value;
    }
    return result;
  };
  return Array.isArray(orderBy)
    ? orderBy.map(validateOne)
    : validateOne(orderBy);
}

export function assertScalarWriteData(
  data: Record<string, unknown>,
  modelMeta: DmmfModelMeta | undefined,
  companyId?: string,
): void {
  const model = requireModel(modelMeta);
  const foreignKeys = new Set(
    model.fields.flatMap((field) => field.relationFromFields ?? []),
  );
  for (const key of Object.keys(asObject(data, 'data'))) {
    if (
      foreignKeys.has(key) &&
      data[key] !== null &&
      typeof data[key] !== 'string'
    )
      throw new ForbiddenException('关联标识必须使用字符串或空值');
    if (
      key === 'id' ||
      (key === 'companyId' &&
        (typeof data[key] !== 'string' ||
          (companyId !== undefined && data[key] !== companyId)))
    ) {
      throw new ForbiddenException('不允许修改资源或租户标识');
    }
    if (getField(model, key).kind === 'object') {
      // Nested Prisma writes bypass root model permissions and specialized APIs.
      // Reference fields are submitted using their scalar foreign-key IDs.
      throw new ForbiddenException('关联资源请通过专用接口维护');
    }
  }
}
