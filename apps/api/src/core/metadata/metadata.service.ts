import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UiSchema } from './schema.types';

@Injectable()
export class MetadataService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly schemas = new Map<string, UiSchema>([
    [
      'order',
      {
        model: 'order',
        label: '订单',
        description: '销售/生产订单主数据。',
        companyScoped: true,
        fields: [
          { name: 'orderNo', label: '订单号', type: 'string' },
          {
            name: 'partnerId',
            label: '客户',
            type: 'reference',
            reference: {
              model: 'partner',
              labelField: 'name',
              valueField: 'id',
              relationField: 'partner',
            },
          },
          {
            name: 'taxCodeId',
            label: '税码',
            type: 'reference',
            required: true,
            reference: {
              model: 'taxCode',
              labelField: 'name',
              valueField: 'id',
              relationField: 'taxCode',
            },
          },
          { name: 'status', label: '状态', type: 'string' },
          { name: 'subTotal', label: '未税金额', type: 'number' },
          { name: 'taxTotal', label: '税额', type: 'number' },
          { name: 'totalAmount', label: '金额', type: 'number' },
          { name: 'expectedDate', label: '交付日期', type: 'date' },
          { name: 'notes', label: '备注', type: 'text' },
        ],
        views: {
          form: {
            fields: [
              'orderNo',
              'partnerId',
              'taxCodeId',
              'status',
              'totalAmount',
              'expectedDate',
              'notes',
            ],
          },
          list: {
            columns: [
              'orderNo',
              'partnerId',
              'taxCodeId',
              'status',
              'subTotal',
              'taxTotal',
              'totalAmount',
              'expectedDate',
            ],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['orderNo', 'status'],
          },
          kanban: {
            statusField: 'status',
            columns: [
              { value: 'DRAFT', label: '草稿', color: 'bg-slate-50' },
              { value: 'PENDING', label: '待处理', color: 'bg-amber-50' },
              { value: 'IN_PRODUCTION', label: '生产中', color: 'bg-sky-50' },
              { value: 'SHIPPED', label: '已发货', color: 'bg-indigo-50' },
              { value: 'COMPLETED', label: '已完成', color: 'bg-emerald-50' },
              { value: 'CANCELLED', label: '已取消', color: 'bg-rose-50' },
            ],
          },
        },
      },
    ],
    [
      'taxCode',
      {
        model: 'taxCode',
        label: '税码',
        description: '企业税码与税率配置。',
        companyScoped: true,
        fields: [
          { name: 'code', label: '税码编码', type: 'string', required: true },
          { name: 'name', label: '税码名称', type: 'string', required: true },
          { name: 'rate', label: '税率', type: 'number', required: true },
          {
            name: 'isTaxInclusive',
            label: '含税计价',
            type: 'boolean',
          },
          { name: 'isDefault', label: '默认税码', type: 'boolean' },
          { name: 'active', label: '启用', type: 'boolean' },
          {
            name: 'accountId',
            label: '税务科目',
            type: 'reference',
            reference: {
              model: 'account',
              labelField: 'name',
              valueField: 'id',
              relationField: 'account',
            },
          },
        ],
        views: {
          form: {
            fields: [
              'code',
              'name',
              'rate',
              'isTaxInclusive',
              'isDefault',
              'active',
              'accountId',
            ],
          },
          list: {
            columns: [
              'code',
              'name',
              'rate',
              'isTaxInclusive',
              'isDefault',
              'active',
              'accountId',
            ],
            defaultSort: { updatedAt: 'desc' },
            searchFields: ['code', 'name'],
          },
        },
      },
    ],
    [
      'stockQuant',
      {
        model: 'stockQuant',
        label: '库存量',
        description: '库存量与批次管理视图。',
        companyScoped: true,
        fields: [
          {
            name: 'locationId',
            label: '库位',
            type: 'reference',
            reference: {
              model: 'stockLocation',
              labelField: 'name',
              valueField: 'id',
              relationField: 'location',
            },
          },
          {
            name: 'materialId',
            label: '物料',
            type: 'reference',
            reference: {
              model: 'material',
              labelField: 'name',
              valueField: 'id',
              relationField: 'material',
            },
          },
          { name: 'batchNo', label: '批次号', type: 'string' },
          { name: 'quantity', label: '数量', type: 'number' },
        ],
        views: {
          form: { fields: ['locationId', 'materialId', 'batchNo', 'quantity'] },
          list: {
            columns: ['locationId', 'materialId', 'batchNo', 'quantity'],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['batchNo'],
          },
        },
      },
    ],
    [
      'workOrder',
      {
        model: 'workOrder',
        label: '工单',
        description: '制造执行工单。',
        companyScoped: true,
        fields: [
          { name: 'workOrderNo', label: '工单号', type: 'string' },
          {
            name: 'orderId',
            label: '订单',
            type: 'reference',
            reference: {
              model: 'order',
              labelField: 'orderNo',
              valueField: 'id',
              relationField: 'order',
            },
          },
          { name: 'productId', label: '产品', type: 'string' },
          { name: 'status', label: '状态', type: 'string' },
          { name: 'plannedQty', label: '计划数量', type: 'number' },
          { name: 'actualQty', label: '实际数量', type: 'number' },
        ],
        views: {
          form: {
            fields: [
              'workOrderNo',
              'orderId',
              'productId',
              'status',
              'plannedQty',
              'actualQty',
            ],
          },
          list: {
            columns: [
              'workOrderNo',
              'orderId',
              'productId',
              'status',
              'plannedQty',
              'actualQty',
            ],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['workOrderNo', 'productId', 'status'],
          },
          kanban: {
            statusField: 'status',
            columns: [
              { value: 'PENDING', label: '待生产', color: 'bg-amber-50' },
              { value: 'IN_PROGRESS', label: '生产中', color: 'bg-sky-50' },
              { value: 'COMPLETED', label: '已完成', color: 'bg-emerald-50' },
            ],
          },
        },
      },
    ],
    [
      'invoice',
      {
        model: 'invoice',
        label: '发票',
        description: '财务发票与回款管理。',
        companyScoped: true,
        fields: [
          { name: 'invoiceNo', label: '发票号', type: 'string' },
          {
            name: 'orderId',
            label: '订单',
            type: 'reference',
            reference: {
              model: 'order',
              labelField: 'orderNo',
              valueField: 'id',
              relationField: 'order',
            },
          },
          {
            name: 'taxCodeId',
            label: '税码',
            type: 'reference',
            required: true,
            reference: {
              model: 'taxCode',
              labelField: 'name',
              valueField: 'id',
              relationField: 'taxCode',
            },
          },
          { name: 'status', label: '状态', type: 'string' },
          { name: 'subTotal', label: '未税金额', type: 'number' },
          { name: 'taxAmount', label: '税额', type: 'number' },
          { name: 'amount', label: '金额', type: 'number' },
          { name: 'dueDate', label: '到期日', type: 'date' },
        ],
        views: {
          form: {
            fields: [
              'invoiceNo',
              'orderId',
              'taxCodeId',
              'status',
              'amount',
              'dueDate',
            ],
          },
          list: {
            columns: [
              'invoiceNo',
              'orderId',
              'taxCodeId',
              'status',
              'subTotal',
              'taxAmount',
              'amount',
              'dueDate',
            ],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['invoiceNo', 'status'],
          },
          kanban: {
            statusField: 'status',
            columns: [
              { value: 'UNPAID', label: '未付款', color: 'bg-rose-50' },
              { value: 'PARTIAL', label: '部分付款', color: 'bg-amber-50' },
              { value: 'PAID', label: '已付款', color: 'bg-emerald-50' },
            ],
          },
        },
      },
    ],
    [
      'fileRecord',
      {
        model: 'fileRecord',
        label: '文件',
        description: '企业文档与图纸档案记录。',
        companyScoped: true,
        fields: [
          { name: 'fileName', label: '文件名', type: 'string' },
          { name: 'mimeType', label: '类型', type: 'string' },
          { name: 'fileSize', label: '大小', type: 'number' },
          { name: 'objectKey', label: '对象路径', type: 'string' },
          { name: 'createdAt', label: '上传时间', type: 'date' },
        ],
        views: {
          form: { fields: ['fileName', 'mimeType', 'fileSize', 'objectKey'] },
          list: {
            columns: ['fileName', 'mimeType', 'fileSize', 'createdAt'],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['fileName', 'mimeType', 'objectKey'],
          },
        },
      },
    ],
    [
      'department',
      {
        model: 'department',
        label: '部门',
        description: '组织架构部门主数据。',
        companyScoped: true,
        fields: [
          { name: 'name', label: '部门名称', type: 'string', required: true },
          { name: 'code', label: '部门编码', type: 'string' },
        ],
        views: {
          form: { fields: ['name', 'code'] },
          list: {
            columns: ['name', 'code'],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['name', 'code'],
          },
        },
      },
    ],
    [
      'userCompanyRole',
      {
        model: 'userCompanyRole',
        label: '员工账号关系',
        description: '当前企业下员工与角色关系。',
        companyScoped: true,
        fields: [
          {
            name: 'userId',
            label: '员工',
            type: 'reference',
            reference: {
              model: 'user',
              labelField: 'name',
              valueField: 'id',
              relationField: 'user',
            },
          },
          {
            name: 'roleId',
            label: '系统角色',
            type: 'reference',
            reference: {
              model: 'role',
              labelField: 'name',
              valueField: 'id',
              relationField: 'role',
            },
          },
          { name: 'createdAt', label: '加入时间', type: 'date' },
        ],
        views: {
          form: { fields: ['userId', 'roleId'] },
          list: {
            columns: ['userId', 'roleId', 'createdAt'],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['userId', 'roleId'],
          },
        },
      },
    ],
    [
      'partner',
      {
        model: 'partner',
        label: '伙伴',
        description: '统一客户/供应商主数据，参考 Odoo res.partner。',
        companyScoped: true,
        fields: [
          { name: 'code', label: '伙伴编码', type: 'string' },
          { name: 'name', label: '伙伴名称', type: 'string', required: true },
          {
            name: 'type',
            label: '伙伴类型',
            type: 'select',
            required: true,
            options: [
              { label: '客户', value: 'CUSTOMER' },
              { label: '供应商', value: 'SUPPLIER' },
              { label: '客户+供应商', value: 'BOTH' },
            ],
          },
          { name: 'contact', label: '联系人', type: 'string' },
          { name: 'phone', label: '电话', type: 'string' },
          { name: 'email', label: '邮箱', type: 'string' },
          { name: 'taxId', label: '税号', type: 'string' },
          { name: 'address', label: '地址', type: 'text' },
          { name: 'isActive', label: '启用', type: 'boolean' },
        ],
        views: {
          form: {
            sections: [
              {
                title: '基础信息',
                fields: ['code', 'name', 'type', 'isActive'],
              },
              {
                title: '联系方式',
                fields: ['contact', 'phone', 'email', 'taxId', 'address'],
              },
            ],
          },
          list: {
            columns: ['code', 'name', 'type', 'contact', 'phone', 'isActive'],
            defaultSort: { createdAt: 'desc' },
            searchFields: [
              'code',
              'name',
              'contact',
              'phone',
              'email',
              'taxId',
            ],
          },
          kanban: {
            statusField: 'type',
            columns: [
              { value: 'CUSTOMER', label: '客户', color: 'bg-blue-50' },
              { value: 'SUPPLIER', label: '供应商', color: 'bg-amber-50' },
              { value: 'BOTH', label: '双角色', color: 'bg-emerald-50' },
            ],
          },
        },
      },
    ],
    [
      'material',
      {
        model: 'material',
        label: '物料',
        description: '物料主数据与库存基础参数。',
        companyScoped: true,
        fields: [
          { name: 'sku', label: 'SKU', type: 'string', required: true },
          { name: 'name', label: '名称', type: 'string', required: true },
          { name: 'category', label: '分类', type: 'string' },
          { name: 'unit', label: '计量单位', type: 'string' },
          { name: 'minStock', label: '最小库存', type: 'number' },
          { name: 'unitPrice', label: '标准成本', type: 'number' },
          { name: 'description', label: '描述', type: 'text' },
        ],
        views: {
          form: {
            fields: [
              'sku',
              'name',
              'category',
              'unit',
              'minStock',
              'unitPrice',
              'description',
            ],
          },
          list: {
            columns: [
              'sku',
              'name',
              'category',
              'unit',
              'minStock',
              'unitPrice',
            ],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['sku', 'name', 'category'],
          },
          kanban: {
            statusField: 'category',
            columns: [],
          },
        },
      },
    ],
    [
      'product',
      {
        model: 'product',
        label: '产品',
        description: '产品主数据，支持和物料/BOM关联。',
        companyScoped: true,
        fields: [
          { name: 'sku', label: '产品编码', type: 'string', required: true },
          { name: 'name', label: '产品名称', type: 'string', required: true },
          {
            name: 'type',
            label: '产品类型',
            type: 'select',
            options: [
              { label: '可库存', value: 'STOCKABLE' },
              { label: '耗材', value: 'CONSUMABLE' },
              { label: '服务', value: 'SERVICE' },
            ],
          },
          { name: 'uom', label: '计量单位', type: 'string' },
          {
            name: 'materialId',
            label: '关联主物料',
            type: 'reference',
            reference: {
              model: 'material',
              labelField: 'name',
              valueField: 'id',
              relationField: 'material',
            },
          },
          {
            name: 'categoryId',
            label: '产品分类',
            type: 'reference',
            reference: {
              model: 'productCategory',
              labelField: 'name',
              valueField: 'id',
              relationField: 'category',
            },
          },
          { name: 'isActive', label: '启用', type: 'boolean' },
          { name: 'description', label: '描述', type: 'text' },
        ],
        views: {
          form: {
            fields: [
              'sku',
              'name',
              'type',
              'uom',
              'categoryId',
              'materialId',
              'isActive',
              'description',
            ],
          },
          list: {
            columns: [
              'sku',
              'name',
              'type',
              'uom',
              'categoryId',
              'materialId',
              'isActive',
            ],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['sku', 'name', 'type'],
          },
          kanban: {
            statusField: 'type',
            columns: [
              { value: 'STOCKABLE', label: '可库存', color: 'bg-blue-50' },
              { value: 'CONSUMABLE', label: '耗材', color: 'bg-amber-50' },
              { value: 'SERVICE', label: '服务', color: 'bg-emerald-50' },
            ],
          },
        },
      },
    ],
    [
      'purchaseInvoice',
      {
        model: 'purchaseInvoice',
        label: '采购发票',
        description: '供应商发票与付款管理。',
        companyScoped: true,
        fields: [
          { name: 'invoiceNo', label: '发票号', type: 'string' },
          { name: 'partnerId', label: '供应商', type: 'reference', reference: { model: 'partner', labelField: 'name', valueField: 'id', relationField: 'partner' } },
          { name: 'taxCodeId', label: '税码', type: 'reference', reference: { model: 'taxCode', labelField: 'name', valueField: 'id', relationField: 'taxCode' } },
          { name: 'taxNature', label: '税务属性', type: 'select', options: [{ label: '进项税', value: 'INPUT' }, { label: '销项税', value: 'OUTPUT' }] },
          { name: 'status', label: '状态', type: 'string' },
          { name: 'subTotal', label: '未税金额', type: 'number' },
          { name: 'taxAmount', label: '税额', type: 'number' },
          { name: 'amount', label: '金额', type: 'number' },
          { name: 'dueDate', label: '到期日', type: 'date' },
        ],
        views: {
          form: { fields: ['invoiceNo', 'partnerId', 'taxCodeId', 'taxNature', 'status', 'amount', 'dueDate'] },
          list: {
            columns: ['invoiceNo', 'partnerId', 'taxCodeId', 'taxNature', 'status', 'subTotal', 'taxAmount', 'amount', 'dueDate'],
            defaultSort: { createdAt: 'desc' },
            searchFields: ['invoiceNo', 'status'],
          },
          kanban: {
            statusField: 'status',
            columns: [
              { value: 'UNPAID', label: '未付款', color: 'bg-rose-50' },
              { value: 'PARTIAL', label: '部分付款', color: 'bg-amber-50' },
              { value: 'PAID', label: '已付款', color: 'bg-emerald-50' },
            ],
          },
        },
      },
    ],
  ]);

  async listSchemas(companyId?: string) {
    const baseSchemas = Array.from(this.schemas.values());
    if (!companyId) {
      return baseSchemas;
    }

    const customFields = await this.prisma.customFieldDefinition.findMany({
      where: { companyId },
      orderBy: [{ modelName: 'asc' }, { createdAt: 'asc' }],
    });

    return baseSchemas.map((schema) => {
      const modelCustomFields = customFields.filter(
        (item) => item.modelName === schema.model,
      );
      return this.mergeCustomFields(schema, modelCustomFields);
    });
  }

  async getSchema(modelName: string, companyId?: string) {
    const key = this.normalize(modelName);
    const schema = this.schemas.get(key);
    if (!schema) {
      throw new NotFoundException(`未找到模型 ${modelName} 的元数据定义`);
    }

    if (!companyId) {
      return schema;
    }

    const customFields = await this.prisma.customFieldDefinition.findMany({
      where: { companyId, modelName: key },
      orderBy: { createdAt: 'asc' },
    });

    return this.mergeCustomFields(schema, customFields);
  }

  upsertSchema(modelName: string, schema: UiSchema) {
    const key = this.normalize(modelName);
    const next = { ...schema, model: key };
    this.schemas.set(key, next);
    return next;
  }

  async listCustomFields(modelName: string, companyId: string) {
    const key = this.normalize(modelName);
    this.assertModelExists(key);

    return this.prisma.customFieldDefinition.findMany({
      where: { companyId, modelName: key },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertCustomField(
    modelName: string,
    companyId: string,
    payload: {
      fieldName: string;
      label: string;
      type: CustomFieldType;
      required?: boolean;
      referenceModel?: string;
      referenceLabelField?: string;
      referenceValueField?: string;
      referenceRelationField?: string;
    },
  ) {
    const key = this.normalize(modelName);
    this.assertModelExists(key);

    const fieldName = payload.fieldName?.trim();
    const label = payload.label?.trim();
    if (!fieldName || !label) {
      throw new BadRequestException('fieldName 和 label 不能为空');
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
      throw new BadRequestException(
        'fieldName 仅支持字母开头的字母/数字/下划线',
      );
    }

    const type = payload.type;
    if (type === CustomFieldType.REF && !payload.referenceModel?.trim()) {
      throw new BadRequestException('REF 类型必须提供 referenceModel');
    }

    return this.prisma.customFieldDefinition.upsert({
      where: {
        companyId_modelName_fieldName: {
          companyId,
          modelName: key,
          fieldName,
        },
      },
      update: {
        label,
        type,
        required: Boolean(payload.required),
        referenceModel: payload.referenceModel?.trim() || null,
        referenceLabelField: payload.referenceLabelField?.trim() || null,
        referenceValueField: payload.referenceValueField?.trim() || null,
        referenceRelationField: payload.referenceRelationField?.trim() || null,
      },
      create: {
        companyId,
        modelName: key,
        fieldName,
        label,
        type,
        required: Boolean(payload.required),
        referenceModel: payload.referenceModel?.trim() || null,
        referenceLabelField: payload.referenceLabelField?.trim() || null,
        referenceValueField: payload.referenceValueField?.trim() || null,
        referenceRelationField: payload.referenceRelationField?.trim() || null,
      },
    });
  }

  async removeCustomField(
    modelName: string,
    companyId: string,
    fieldName: string,
  ) {
    const key = this.normalize(modelName);
    this.assertModelExists(key);

    return this.prisma.customFieldDefinition.delete({
      where: {
        companyId_modelName_fieldName: {
          companyId,
          modelName: key,
          fieldName: fieldName.trim(),
        },
      },
    });
  }

  async validateCustomAttributes(
    modelName: string,
    data: Record<string, unknown>,
    companyId?: string,
  ) {
    if (!companyId) return;
    const customAttributes = data.customAttributes;
    if (customAttributes === undefined || customAttributes === null) return;

    if (
      typeof customAttributes !== 'object' ||
      Array.isArray(customAttributes)
    ) {
      throw new BadRequestException('customAttributes 必须是对象');
    }

    const key = this.normalize(modelName);
    const customFields = await this.prisma.customFieldDefinition.findMany({
      where: { companyId, modelName: key },
    });

    const attributes = customAttributes as Record<string, unknown>;
    for (const definition of customFields) {
      const value = attributes[definition.fieldName];
      if (
        definition.required &&
        (value === undefined || value === null || value === '')
      ) {
        throw new BadRequestException(
          `自定义字段 ${definition.fieldName} 为必填`,
        );
      }
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (
        definition.type === CustomFieldType.STRING &&
        typeof value !== 'string'
      ) {
        throw new BadRequestException(
          `自定义字段 ${definition.fieldName} 需要字符串`,
        );
      }
      if (
        definition.type === CustomFieldType.NUMBER &&
        typeof value !== 'number'
      ) {
        throw new BadRequestException(
          `自定义字段 ${definition.fieldName} 需要数字`,
        );
      }
      if (
        definition.type === CustomFieldType.REF &&
        typeof value !== 'string'
      ) {
        throw new BadRequestException(
          `自定义字段 ${definition.fieldName} 需要引用ID字符串`,
        );
      }
    }
  }

  isCompanyScoped(modelName: string) {
    const key = this.normalize(modelName);
    return this.schemas.get(key)?.companyScoped ?? false;
  }

  private mergeCustomFields(
    schema: UiSchema,
    customFields: Array<{
      fieldName: string;
      label: string;
      type: CustomFieldType;
      required: boolean;
      referenceModel: string | null;
      referenceLabelField: string | null;
      referenceValueField: string | null;
      referenceRelationField: string | null;
    }>,
  ): UiSchema {
    if (!customFields.length) {
      return schema;
    }

    const mappedFields = customFields.map((field) => ({
      name: `customAttributes.${field.fieldName}`,
      label: field.label,
      type:
        field.type === CustomFieldType.NUMBER
          ? ('number' as const)
          : field.type === CustomFieldType.REF
            ? ('reference' as const)
            : ('string' as const),
      required: field.required,
      custom: true,
      reference:
        field.type === CustomFieldType.REF && field.referenceModel
          ? {
              model: field.referenceModel,
              labelField: field.referenceLabelField ?? 'name',
              valueField: field.referenceValueField ?? 'id',
              relationField: field.referenceRelationField ?? undefined,
            }
          : undefined,
    }));

    const mergedFields = [...schema.fields];
    for (const field of mappedFields) {
      if (!mergedFields.find((item) => item.name === field.name)) {
        mergedFields.push(field);
      }
    }

    const formView = { ...schema.views.form };
    const customFieldNames = mappedFields.map((field) => field.name);

    if (formView.sections?.length) {
      const sections = [...formView.sections];
      const hasCustomSection = sections.find(
        (section) => section.title === '自定义字段',
      );
      if (hasCustomSection) {
        hasCustomSection.fields = Array.from(
          new Set([...hasCustomSection.fields, ...customFieldNames]),
        );
      } else {
        sections.push({ title: '自定义字段', fields: customFieldNames });
      }
      formView.sections = sections;
    } else {
      const existingFields = formView.fields ?? mergedFields.map((f) => f.name);
      formView.fields = Array.from(
        new Set([...existingFields, ...customFieldNames]),
      );
    }

    const listView = { ...schema.views.list };
    listView.columns = Array.from(
      new Set([...(listView.columns ?? []), ...customFieldNames]),
    );

    return {
      ...schema,
      fields: mergedFields,
      views: {
        ...schema.views,
        form: formView,
        list: listView,
      },
    };
  }

  private assertModelExists(modelName: string) {
    if (!this.schemas.has(modelName)) {
      throw new NotFoundException(`未找到模型 ${modelName} 的元数据定义`);
    }
  }

  private normalize(modelName: string) {
    return modelName?.trim();
  }
}
