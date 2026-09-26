import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { assertGenericModelAllowed } from './crud-access-policy';
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
    const normalizedModelName = this.normalizeModelName(modelName);
    const model = this.resolveModel(normalizedModelName);
    const modelMeta = this.getDmmfModelMeta(normalizedModelName);
    const rawFilter =
      parseJsonParam<Record<string, unknown>>(query.filter) ?? {};
    const resolveMeta = (name: string) => this.getDmmfModelMeta(name);
    const filter = sanitizeFilter(rawFilter, modelMeta, resolveMeta);
    const where = this.applyCompanyScope(
      normalizedModelName,
      { ...filter },
      companyId,
    );
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

    const [data, total] = await Promise.all([
      model.findMany({ where, select, include, orderBy, skip, take }),
      model.count({ where }),
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
    const normalizedModelName = this.normalizeModelName(modelName);
    const model = this.resolveModel(normalizedModelName);
    const where = this.applyCompanyScope(
      normalizedModelName,
      { id },
      companyId,
    );

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

    const record = await model.findFirst({ where, select, include });
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
    const created = await model.create({ data: writeData });
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
    const updated = await model.update({
      where,
      data: writeData,
    });
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
    const removed = await model.delete({ where: { id } });
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

  private resolveModel(modelName: string): DynamicModelDelegate {
    assertGenericModelAllowed(modelName);
    if (!this.getDmmfModelMeta(modelName)) {
      throw new BadRequestException(`未知模型: ${modelName}`);
    }
    const candidate = (this.prisma as unknown as Record<string, unknown>)[
      modelName
    ];

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
    if (!companyId) return where;
    if (!this.metadataService.isCompanyScoped(modelName)) return where;
    if (Object.prototype.hasOwnProperty.call(where, 'companyId')) {
      if (where.companyId !== companyId) {
        throw new ForbiddenException('companyId 与当前租户上下文不一致');
      }
      return where;
    }
    return { ...where, companyId };
  }

  private applyCompanyIdToData(
    modelName: string,
    data: Record<string, unknown>,
    companyId?: string,
  ): Record<string, unknown> {
    if (!companyId) return data;
    if (!this.metadataService.isCompanyScoped(modelName)) return data;
    if (Object.prototype.hasOwnProperty.call(data, 'companyId')) {
      if (data.companyId !== companyId) {
        throw new ForbiddenException('companyId 与当前租户上下文不一致');
      }
      return data;
    }
    return { ...data, companyId };
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
    const existingOr = where.OR;
    if (Array.isArray(existingOr)) {
      const existingFilters = existingOr.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      );
      where.OR = [...existingFilters, ...searchFields];
      return;
    }
    where.OR = searchFields;
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
    if (modelName === 'order') {
      throw new ForbiddenException('订单请通过订单专用接口维护');
    }
    if (modelName === 'orderItem') {
      throw new ForbiddenException('订单明细请通过订单专用接口维护');
    }
    if (
      modelName === 'purchaseOrder' ||
      modelName === 'purchaseOrderLine' ||
      modelName === 'purchaseReceipt' ||
      modelName === 'purchaseReceiptLine' ||
      modelName === 'purchaseInvoice'
    ) {
      throw new ForbiddenException('采购单据请通过采购专用接口维护');
    }
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
    return getDmmfModel(this.prisma, modelName);
  }
}
