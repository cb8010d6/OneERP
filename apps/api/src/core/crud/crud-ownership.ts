import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getResourcePolicy } from './crud-access-policy';
import { DmmfFieldMeta, DmmfModelMeta } from './crud-query-validator';

type Where = Record<string, unknown>;
type Resolve = (name: string) => DmmfModelMeta | undefined;

export function andWhere(...conditions: Where[]): Where {
  const parts = conditions.filter((item) => Object.keys(item).length);
  if (!parts.length) return {};
  const keys = parts.flatMap((item) => Object.keys(item));
  if (new Set(keys).size === keys.length)
    return parts.reduce<Where>((result, part) => ({ ...result, ...part }), {});
  return { AND: parts };
}

function requireMeta(name: string, resolve: Resolve): DmmfModelMeta {
  const model = resolve(name);
  if (!model) throw new BadRequestException('无法验证资源所有权元数据');
  getResourcePolicy(model.name);
  return model;
}

export function requireCompanyId(companyId?: string): string {
  if (!companyId?.trim()) throw new ForbiddenException('缺少当前租户上下文');
  return companyId;
}

// Only these reviewed parent paths grant ownership to models without companyId.
// Do not search arbitrary relations for a company: that can authorize a row via
// an unrelated reference, e.g. a journal line's account instead of its entry.
export function ownershipWhere(
  model: DmmfModelMeta,
  companyId: string,
  resolve: Resolve,
  sharedMaterial = false,
): Where {
  requireCompanyId(companyId);
  const { owner } = getResourcePolicy(model.name);
  if (owner === 'company') {
    const field = model.fields.find((item) => item.name === 'companyId');
    if (
      field?.kind !== 'scalar' ||
      field.type !== 'String' ||
      field.isList ||
      (model.name === 'Material'
        ? field.isRequired !== false
        : field.isRequired !== true)
    ) {
      throw new BadRequestException('无法验证资源的租户字段');
    }
    return sharedMaterial && model.name === 'Material'
      ? { OR: [{ companyId }, { companyId: null }] }
      : { companyId };
  }
  const relation = model.fields.find((field) => field.name === owner.relation);
  if (
    relation?.kind !== 'object' ||
    relation.isList ||
    relation.isRequired !== true ||
    relation.type !== owner.model
  ) {
    throw new BadRequestException('无法验证资源的所属关系');
  }
  const parent = requireMeta(owner.model, resolve);
  if (getResourcePolicy(parent.name).owner !== 'company')
    throw new BadRequestException('不支持多级资源所有权');
  return {
    [owner.relation]: { is: ownershipWhere(parent, companyId, resolve) },
  };
}

function relationGuard(field: DmmfFieldMeta, where: Where): Where {
  if (typeof field.isRequired !== 'boolean')
    throw new BadRequestException('无法验证关联是否可为空');
  const owned = { [field.name]: { is: where } };
  return field.isRequired ? owned : { OR: [{ [field.name]: null }, owned] };
}

/** Compiles already validated Prisma queries. Guards are separate from user
 * predicates so NOT/OR cannot negate authorization. Nullable to-one relations
 * retain null, while legacy cross-company links never expose related values.
 */
export function scopeResourceQuery(
  model: DmmfModelMeta,
  companyId: string,
  resolve: Resolve,
  query: { where: Where; select?: Where; include?: Where },
  sharedMaterial = false,
): { where: Where; select?: Where; include?: Where } {
  const filter = scopeFilter(model, query.where, companyId, resolve);
  const projection = scopeProjection(
    model,
    query.select ?? query.include,
    companyId,
    resolve,
  );
  return {
    where: andWhere(
      ownershipWhere(model, companyId, resolve, sharedMaterial),
      filter.where,
      ...filter.guards,
      ...projection.guards,
    ),
    select: query.select ? projection.value : undefined,
    include: query.include ? projection.value : undefined,
  };
}

function scopeFilter(
  model: DmmfModelMeta,
  input: Where,
  companyId: string,
  resolve: Resolve,
): {
  where: Where;
  guards: Where[];
} {
  const where: Where = {};
  const guards: Where[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (['AND', 'OR', 'NOT'].includes(key)) {
      const visit = (item: Where) => {
        const result = scopeFilter(model, item, companyId, resolve);
        guards.push(...result.guards);
        return result.where;
      };
      where[key] = Array.isArray(value)
        ? value.map(visit)
        : visit(value as Where);
      continue;
    }
    const field = model.fields.find((item) => item.name === key);
    if (!field) throw new BadRequestException('无法验证过滤字段');
    if (field.kind !== 'object') {
      where[key] = value;
      continue;
    }
    const target = requireMeta(field.type, resolve);
    const targetScope = ownershipWhere(target, companyId, resolve, true);
    if (!field.isList) {
      // This guard deliberately lives outside every user logical operator.
      guards.push(relationGuard(field, targetScope));
      if (value === null) {
        where[key] = null;
        continue;
      }
      const nested = value as Where;
      const operators = Object.keys(nested);
      if (operators.some((item) => item === 'is' || item === 'isNot')) {
        where[key] = Object.fromEntries(
          Object.entries(nested).map(([operator, predicate]) => [
            operator,
            predicate === null
              ? null
              : scopeResourceQuery(
                  target,
                  companyId,
                  resolve,
                  { where: predicate as Where },
                  true,
                ).where,
          ]),
        );
      } else {
        where[key] = {
          is: scopeResourceQuery(
            target,
            companyId,
            resolve,
            { where: nested },
            true,
          ).where,
        };
      }
      continue;
    }
    where[key] = Object.fromEntries(
      Object.entries(value as Where).map(([operator, predicate]) => {
        if (!['some', 'none', 'every'].includes(operator))
          throw new BadRequestException('列表关联必须使用 some/none/every');
        const nested = scopeResourceQuery(
          target,
          companyId,
          resolve,
          { where: predicate as Where },
          true,
        ).where;
        // every is vacuously true for inaccessible rows, unlike some/none.
        return [
          operator,
          operator === 'every'
            ? { OR: [{ NOT: targetScope }, nested] }
            : nested,
        ];
      }),
    );
  }
  return { where, guards };
}

function scopeProjection(
  model: DmmfModelMeta,
  input: Where | undefined,
  companyId: string,
  resolve: Resolve,
): {
  value: Where | undefined;
  guards: Where[];
} {
  if (!input) return { value: undefined, guards: [] };
  const value: Where = {};
  const guards: Where[] = [];
  for (const [name, requested] of Object.entries(input)) {
    if (name === '_count') {
      if (requested === false) {
        value[name] = false;
        continue;
      }
      const selections =
        requested === true
          ? Object.fromEntries(
              model.fields
                .filter((field) => field.kind === 'object' && field.isList)
                .map((field) => [field.name, true]),
            )
          : (requested as { select: Where }).select;
      const counts: Where = {};
      for (const [relation, selection] of Object.entries(selections)) {
        if (selection === false) {
          counts[relation] = false;
          continue;
        }
        const field = model.fields.find((item) => item.name === relation);
        if (!field || field.kind !== 'object' || !field.isList)
          throw new BadRequestException('无法验证计数关联');
        const target = requireMeta(field.type, resolve);
        const filter =
          selection === true ? {} : (selection as { where: Where }).where;
        counts[relation] = {
          where: scopeResourceQuery(
            target,
            companyId,
            resolve,
            { where: filter },
            true,
          ).where,
        };
      }
      value[name] = { select: counts };
      continue;
    }
    const field = model.fields.find((item) => item.name === name);
    if (!field) throw new BadRequestException('无法验证投影字段');
    if (requested === false || field.kind !== 'object') {
      value[name] = requested;
      continue;
    }
    const target = requireMeta(field.type, resolve);
    const args = requested === true ? {} : (requested as Where);
    const scoped = scopeResourceQuery(
      target,
      companyId,
      resolve,
      {
        where: (args.where as Where | undefined) ?? {},
        select: args.select as Where | undefined,
        include: args.include as Where | undefined,
      },
      true,
    );
    if (field.isList) {
      value[name] = { ...args, ...scoped };
    } else {
      if (
        Object.keys(args).some(
          (key) => !['select', 'include', 'where'].includes(key),
        )
      )
        throw new BadRequestException('单条关联仅支持 select/include/where');
      guards.push(relationGuard(field, scoped.where));
      // Required to-one DefaultArgs in Prisma do not support a where clause.
      value[name] =
        requested === true
          ? true
          : {
              ...(scoped.select ? { select: scoped.select } : {}),
              ...(scoped.include ? { include: scoped.include } : {}),
            };
    }
  }
  return { value, guards };
}

interface ReferenceDelegate {
  findUnique(args: { where: Where }): Promise<Where | null>;
}

// A generic master delete must not silently cascade or SET NULL on another
// resource. These are existence checks, deliberately without tenant predicates:
// even a malformed foreign dependent must prevent the destructive side effect.
// Keep the resulting condition on the final DELETE, not just a preflight read.
export function unreferencedWhere(
  model: DmmfModelMeta,
  resolve: Resolve,
): Where {
  const where: Where = {};
  for (const relation of model.fields.filter(
    (field) => field.kind === 'object',
  )) {
    if (!Array.isArray(relation.relationFromFields))
      throw new BadRequestException('无法验证资源依赖关系');
    if (relation.relationFromFields.length) continue;
    const target = resolve(relation.type);
    const inverse = target?.fields.find(
      (field) =>
        field.kind === 'object' &&
        field.type === model.name &&
        field.relationName === relation.relationName &&
        Array.isArray(field.relationFromFields) &&
        field.relationFromFields.length > 0,
    );
    if (
      !relation.relationName ||
      !inverse ||
      (!relation.isList && relation.isRequired !== false)
    )
      throw new BadRequestException('无法验证资源依赖关系');
    where[relation.name] = relation.isList ? { none: {} } : { is: null };
  }
  return where;
}

/** Check the final post-hook scalar references in the same transaction as the
 * write. A unique lookup is deliberately authorized *after* retrieval: this
 * allows the documented shared Material reference without changing tenant
 * middleware or exposing shared records through generic root CRUD.
 */
export async function assertOwnedReferences(
  client: unknown,
  model: DmmfModelMeta,
  data: Where,
  companyId: string,
  resolve: Resolve,
): Promise<void> {
  for (const relation of model.fields.filter(
    (field) => field.kind === 'object',
  )) {
    const from = relation.relationFromFields;
    const to = relation.relationToFields;
    if (!Array.isArray(from) || !Array.isArray(to))
      throw new ForbiddenException('无法验证关联字段元数据');
    if (!from.length) continue;
    if (
      relation.type === 'Company' &&
      from.length === 1 &&
      from[0] === 'companyId'
    )
      continue;
    if (from.length !== 1 || to.length !== 1)
      throw new ForbiddenException('通用接口不支持此复合关联写入');
    const id = data[from[0]];
    if (id === undefined) continue;
    if (id === null && relation.isRequired === false) continue;
    if (typeof id !== 'string' || !id)
      throw new ForbiddenException('关联标识必须是非空字符串');
    const target = requireMeta(relation.type, resolve);
    const targetKey = target.fields.find((field) => field.name === to[0]);
    if (
      targetKey?.kind !== 'scalar' ||
      targetKey.type !== 'String' ||
      targetKey.isList ||
      (!targetKey.isId && !targetKey.isUnique)
    )
      throw new ForbiddenException('无法验证关联的唯一标识');
    // Writable masters reference directly company-owned models only.
    if (getResourcePolicy(target.name).owner !== 'company')
      throw new ForbiddenException('此关联请通过专用接口维护');
    ownershipWhere(target, companyId, resolve, true);
    const delegateName =
      target.name.charAt(0).toLowerCase() + target.name.slice(1);
    const delegate = (client as Record<string, ReferenceDelegate>)[
      delegateName
    ];
    if (typeof delegate?.findUnique !== 'function')
      throw new ForbiddenException('无法验证关联资源');
    const record = await delegate.findUnique({
      where: { [targetKey.name]: id },
    });
    if (
      !record ||
      (record.companyId !== companyId &&
        !(target.name === 'Material' && record.companyId === null))
    )
      throw new ForbiddenException('关联资源不存在或不属于当前租户');
  }
}
