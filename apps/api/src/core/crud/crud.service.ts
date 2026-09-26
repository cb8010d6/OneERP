import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetadataService } from '../metadata/metadata.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../dto/pagination.dto';
import { CrudHookContext, CrudHooksService } from './crud-hooks.service';
import { ResourceQueryDto } from './resource-query.dto';
import {
  normalizeSelect,
  parseJsonParam,
  parseOrderByParam,
} from './query-utils';
import {
  getDmmfModel,
  sanitizeFilter,
  sanitizeInclude,
  sanitizeOrderBy,
  sanitizeSelect,
  assertScalarWriteData,
} from './crud-query-validator';
import {
  assertGenericModelAllowed,
  assertGenericWriteAllowed,
  getResourcePolicy,
} from './crud-access-policy';
import {
  andWhere,
  assertOwnedReferences,
  ownershipWhere,
  requireCompanyId,
  scopeResourceQuery,
  unreferencedWhere,
} from './crud-ownership';
import { TenantContext } from '../tenant/tenant-context';

interface DynamicModelDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  count(args: Record<string, unknown>): Promise<number>;
  findFirst(args: Record<string, unknown>): Promise<unknown>;
  create(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
}

@Injectable()
export class CrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadataService: MetadataService,
    private readonly crudHooksService: CrudHooksService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    modelName: string,
    query: ResourceQueryDto,
    companyId?: string,
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    companyId = this.resolveCompanyId(companyId);
    const normalizedModelName = this.normalizeModelName(modelName);
    const model = this.resolveModel(normalizedModelName);
    const modelMeta = this.getDmmfModelMeta(normalizedModelName);
    const rawFilter =
      parseJsonParam<Record<string, unknown>>(query.filter) ?? {};
    const resolveMeta = (name: string) => this.getDmmfModelMeta(name);
    const filter = sanitizeFilter(rawFilter, modelMeta, resolveMeta);
    const where = { ...filter };
    await this.applyKeywordSearch(
      normalizedModelName,
      where,
      query.search,
      query.searchFields,
    );

    const fields = parseJsonParam(query.fields, { allowCommaList: true });
    const select = sanitizeSelect(
      normalizeSelect(fields),
      modelMeta,
      resolveMeta,
    );
    const rawInclude = select
      ? undefined
      : parseJsonParam<Record<string, unknown>>(query.include);
    const include = sanitizeInclude(rawInclude, modelMeta, resolveMeta);
    const schema = await this.getSchemaIfExists(normalizedModelName, companyId);
    const rawOrderBy =
      parseOrderByParam(query.orderBy) ?? schema?.views.list.defaultSort;
    const orderBy = sanitizeOrderBy(rawOrderBy, modelMeta);

    const { page = 1, limit = 20 } = query;
    const { skip, take } = paginate(page, limit);

    const scoped = scopeResourceQuery(modelMeta, companyId, resolveMeta, {
      where,
      select,
      include,
    });
    const [data, total] = await Promise.all([
      model.findMany({ ...scoped, orderBy, skip, take }),
      model.count({ where: scoped.where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(
    modelName: string,
    id: string,
    query: ResourceQueryDto,
    companyId?: string,
  ): Promise<unknown> {
    companyId = this.resolveCompanyId(companyId);
    const normalizedModelName = this.normalizeModelName(modelName);
    const model = this.resolveModel(normalizedModelName);
    const where = { id };

    const findOneModelMeta = this.getDmmfModelMeta(normalizedModelName);
    const resolveMeta = (name: string) => this.getDmmfModelMeta(name);
    const fields = parseJsonParam(query.fields, { allowCommaList: true });
    const select = sanitizeSelect(
      normalizeSelect(fields),
      findOneModelMeta,
      resolveMeta,
    );
    const rawInclude = select
      ? undefined
      : parseJsonParam<Record<string, unknown>>(query.include);
    const include = sanitizeInclude(rawInclude, findOneModelMeta, resolveMeta);

    const scoped = scopeResourceQuery(
      findOneModelMeta,
      companyId,
      resolveMeta,
      { where, select, include },
    );
    const record = await model.findFirst(scoped);
    if (!record) {
      throw new NotFoundException(`${modelName} 不存在或无权访问`);
    }
    return record;
  }

  async create(
    modelName: string,
    data: Record<string, unknown>,
    companyId?: string,
  ): Promise<unknown> {
    companyId = this.resolveCompanyId(companyId);
    const normalizedModelName = this.normalizeModelName(modelName);
    this.assertSpecializedModelWriteAllowed(normalizedModelName);
    this.resolveModel(normalizedModelName);
    assertScalarWriteData(
      data,
      this.getDmmfModelMeta(normalizedModelName),
      companyId,
    );
    const payload = this.applyCompanyIdToData(
      normalizedModelName,
      { ...data },
      companyId,
    );

    let ctx: CrudHookContext = {
      modelName: normalizedModelName,
      operation: 'create',
      companyId,
      data: payload,
    };

    ctx = await this.crudHooksService.execute('beforeValidate', ctx);
    await this.metadataService.validateCustomAttributes(
      normalizedModelName,
      ctx.data ?? {},
      companyId,
    );
    ctx = await this.crudHooksService.execute('beforeInsert', ctx);

    const writeData = this.applyCompanyIdToData(
      normalizedModelName,
      ctx.data ?? payload,
      companyId,
    );
    assertScalarWriteData(
      writeData,
      this.getDmmfModelMeta(normalizedModelName),
      companyId,
    );
    const created = await this.prisma.$transaction(
      async (tx) => {
        await assertOwnedReferences(
          tx,
          this.getDmmfModelMeta(normalizedModelName),
          writeData,
          companyId,
          (name) => this.getDmmfModelMeta(name),
        );
        return this.resolveModel(normalizedModelName, tx).create({
          data: writeData,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.auditService.logCrudAction({
      modelName: normalizedModelName,
      recordId: this.extractRecordId(created),
      companyId: companyId ?? TenantContext.getCompanyId(),
      userId: TenantContext.getUserId(),
      action: 'CRUD_CREATE',
      after: created,
      input: ctx.data ?? payload,
    });
    ctx = await this.crudHooksService.execute('afterInsert', {
      ...ctx,
      result: created,
    });

    return ctx.result ?? created;
  }

  async update(
    modelName: string,
    id: string,
    data: Record<string, unknown>,
    companyId?: string,
  ): Promise<unknown> {
    companyId = this.resolveCompanyId(companyId);
    const normalizedModelName = this.normalizeModelName(modelName);
    this.assertSpecializedModelWriteAllowed(normalizedModelName);
    const model = this.resolveModel(normalizedModelName);
    assertScalarWriteData(
      data,
      this.getDmmfModelMeta(normalizedModelName),
      companyId,
    );
    const payload = this.applyCompanyIdToData(
      normalizedModelName,
      { ...data },
      companyId,
    );
    const where = this.applyCompanyScope(
      normalizedModelName,
      { id },
      companyId,
    );
    const existing = await model.findFirst({ where });
    if (!existing) {
      throw new NotFoundException(`${modelName} 不存在或无权访问`);
    }
    this.assertMutableState(normalizedModelName, existing, 'update');

    let ctx: CrudHookContext = {
      modelName: normalizedModelName,
      operation: 'update',
      companyId,
      id,
      data: payload,
      existing,
    };

    ctx = await this.crudHooksService.execute('beforeValidate', ctx);
    await this.metadataService.validateCustomAttributes(
      normalizedModelName,
      ctx.data ?? {},
      companyId,
    );
    ctx = await this.crudHooksService.execute('beforeUpdate', ctx);

    const writeData = this.applyCompanyIdToData(
      normalizedModelName,
      ctx.data ?? payload,
      companyId,
    );
    assertScalarWriteData(
      writeData,
      this.getDmmfModelMeta(normalizedModelName),
      companyId,
    );
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const writeModel = this.resolveModel(normalizedModelName, tx);
        const current = await writeModel.findFirst({ where });
        if (!current)
          throw new NotFoundException(`${modelName} 不存在或无权访问`);
        await assertOwnedReferences(
          tx,
          this.getDmmfModelMeta(normalizedModelName),
          { ...(current as Record<string, unknown>), ...writeData },
          companyId,
          (name) => this.getDmmfModelMeta(name),
        );
        return writeModel.update({ where, data: writeData });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.auditService.logCrudAction({
      modelName: normalizedModelName,
      recordId: id,
      companyId: companyId ?? TenantContext.getCompanyId(),
      userId: TenantContext.getUserId(),
      action: 'CRUD_UPDATE',
      before: existing,
      after: updated,
      input: ctx.data ?? data,
    });
    ctx = await this.crudHooksService.execute('afterUpdate', {
      ...ctx,
      result: updated,
    });

    return ctx.result ?? updated;
  }

  async remove(
    modelName: string,
    id: string,
    companyId?: string,
  ): Promise<unknown> {
    companyId = this.resolveCompanyId(companyId);
    const normalizedModelName = this.normalizeModelName(modelName);
    this.assertSpecializedModelWriteAllowed(normalizedModelName);
    const model = this.resolveModel(normalizedModelName);
    const where = this.applyCompanyScope(
      normalizedModelName,
      { id },
      companyId,
    );
    const existing = await model.findFirst({ where });
    if (!existing) {
      throw new NotFoundException(`${modelName} 不存在或无权访问`);
    }
    this.assertMutableState(normalizedModelName, existing, 'delete');

    let ctx: CrudHookContext = {
      modelName: normalizedModelName,
      operation: 'delete',
      companyId,
      id,
      existing,
    };

    ctx = await this.crudHooksService.execute('beforeDelete', ctx);
    const removed = await this.prisma.$transaction(
      async (tx) => {
        const writeModel = this.resolveModel(normalizedModelName, tx);
        const current = await writeModel.findFirst({ where });
        if (!current)
          throw new NotFoundException(`${modelName} 不存在或无权访问`);
        const deleteWhere = andWhere(
          where,
          unreferencedWhere(
            this.getDmmfModelMeta(normalizedModelName),
            (name) => this.getDmmfModelMeta(name),
          ),
        );
        if (
          !(await writeModel.findFirst({
            where: deleteWhere,
            select: { id: true },
          }))
        )
          throw new ForbiddenException(
            '此资源已被引用，请通过专用流程清理依赖后再删除',
          );
        return writeModel.delete({ where: deleteWhere });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.auditService.logCrudAction({
      modelName: normalizedModelName,
      recordId: id,
      companyId: companyId ?? TenantContext.getCompanyId(),
      userId: TenantContext.getUserId(),
      action: 'CRUD_DELETE',
      before: existing,
    });
    ctx = await this.crudHooksService.execute('afterDelete', {
      ...ctx,
      result: removed,
    });

    return ctx.result ?? removed;
  }

  private resolveModel(
    modelName: string,
    client: unknown = this.prisma,
  ): DynamicModelDelegate {
    if (!this.getDmmfModelMeta(modelName)) {
      throw new BadRequestException(`未知模型: ${modelName}`);
    }
    assertGenericModelAllowed(modelName);
    const candidate = (client as Record<string, unknown>)[modelName];

    if (!this.isDynamicModelDelegate(candidate)) {
      throw new BadRequestException(`未知模型: ${modelName}`);
    }

    return candidate;
  }

  private applyCompanyScope(
    modelName: string,
    where: Record<string, unknown>,
    companyId?: string,
  ): Record<string, unknown> {
    const meta = this.getDmmfModelMeta(modelName);
    if (!meta) throw new BadRequestException('无法验证资源所有权元数据');
    return andWhere(
      where,
      ownershipWhere(meta, requireCompanyId(companyId), (name) =>
        this.getDmmfModelMeta(name),
      ),
    );
  }

  private applyCompanyIdToData(
    modelName: string,
    data: Record<string, unknown>,
    companyId?: string,
  ): Record<string, unknown> {
    const tenant = requireCompanyId(companyId);
    const meta = this.getDmmfModelMeta(modelName);
    if (!meta) throw new BadRequestException('无法验证资源所有权元数据');
    ownershipWhere(meta, tenant, (name) => this.getDmmfModelMeta(name));
    assertScalarWriteData(data, meta, tenant);
    return getResourcePolicy(modelName).owner === 'company'
      ? { ...data, companyId: tenant }
      : data;
  }

  private resolveCompanyId(companyId?: string): string {
    const context = TenantContext.getCompanyId();
    if (context && companyId && context !== companyId)
      throw new ForbiddenException('companyId 与当前租户上下文不一致');
    return requireCompanyId(companyId ?? context);
  }

  private async applyKeywordSearch(
    modelName: string,
    where: Record<string, unknown>,
    keyword?: string,
    searchFieldsParam?: string,
  ) {
    const search = keyword?.trim();
    if (!search) return;

    const configuredFields =
      parseJsonParam<string[]>(searchFieldsParam, { allowCommaList: true }) ??
      (await this.getSchemaIfExists(modelName))?.views.list.searchFields ??
      [];

    const searchFields = configuredFields
      .map((field) => String(field).trim())
      .filter(Boolean)
      .map((field) =>
        sanitizeFilter(
          {
            [field]: { contains: search, mode: 'insensitive' as const },
          },
          this.getDmmfModelMeta(modelName),
          (name) => this.getDmmfModelMeta(name),
        ),
      );

    if (!searchFields.length) return;
    const existing = { ...where };
    for (const key of Object.keys(where)) delete where[key];
    Object.assign(where, andWhere(existing, { OR: searchFields }));
  }

  private normalizeModelName(modelName: string) {
    return modelName.trim();
  }

  private async getSchemaIfExists(modelName: string, companyId?: string) {
    try {
      return await this.metadataService.getSchema(modelName, companyId);
    } catch {
      return undefined;
    }
  }

  private isDynamicModelDelegate(
    value: unknown,
  ): value is DynamicModelDelegate {
    if (!value || typeof value !== 'object') return false;
    const model = value as Record<string, unknown>;

    return (
      typeof model.findMany === 'function' &&
      typeof model.count === 'function' &&
      typeof model.findFirst === 'function' &&
      typeof model.create === 'function' &&
      typeof model.update === 'function' &&
      typeof model.delete === 'function'
    );
  }

  private extractRecordId(record: unknown): string {
    if (
      typeof record === 'object' &&
      record !== null &&
      'id' in record &&
      typeof (record as { id?: unknown }).id === 'string'
    ) {
      return (record as { id: string }).id;
    }

    return '';
  }

  private assertMutableState(
    modelName: string,
    existing: unknown,
    operation: 'update' | 'delete',
  ) {
    if (modelName !== 'order') {
      return;
    }

    const status = this.readStatus(existing);
    if (!status) {
      return;
    }

    if (operation === 'update' && !['DRAFT', 'SUBMITTED'].includes(status)) {
      throw new BadRequestException(
        `当前单据状态为 ${status}，仅 DRAFT/SUBMITTED 状态允许修改`,
      );
    }

    if (operation === 'delete' && status !== 'DRAFT') {
      throw new BadRequestException(
        `当前单据状态为 ${status}，仅 DRAFT 状态允许删除`,
      );
    }
  }

  private assertSpecializedModelWriteAllowed(modelName: string) {
    assertGenericWriteAllowed(modelName);
  }

  private readStatus(record: unknown): string | undefined {
    if (!record || typeof record !== 'object') {
      return undefined;
    }

    const candidate = (record as Record<string, unknown>).status;
    if (typeof candidate !== 'string') {
      return undefined;
    }

    return candidate;
  }

  private getDmmfModelMeta(modelName: string) {
    const model = getDmmfModel(this.prisma, modelName);
    if (!model) throw new BadRequestException(`未知模型: ${modelName}`);
    return model;
  }
}
