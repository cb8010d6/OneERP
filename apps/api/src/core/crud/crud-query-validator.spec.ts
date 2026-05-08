import { BadRequestException } from '@nestjs/common';
import {
  sanitizeInclude,
  sanitizeFilter,
  sanitizeOrderBy,
  getDmmfModel,
  DmmfModelMeta,
} from './crud-query-validator';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const orderModelMeta: DmmfModelMeta = {
  name: 'Order',
  fields: [
    { name: 'id', kind: 'scalar', type: 'String', isList: false },
    { name: 'orderNo', kind: 'scalar', type: 'String', isList: false },
    { name: 'partnerId', kind: 'scalar', type: 'String', isList: false },
    { name: 'companyId', kind: 'scalar', type: 'String', isList: false },
    { name: 'status', kind: 'scalar', type: 'String', isList: false },
    { name: 'totalAmount', kind: 'scalar', type: 'Float', isList: false },
    { name: 'createdAt', kind: 'scalar', type: 'DateTime', isList: false },
    { name: 'partner', kind: 'object', type: 'Partner', isList: false },
    { name: 'items', kind: 'object', type: 'OrderItem', isList: true },
  ],
};

// ---------------------------------------------------------------------------
// sanitizeInclude
// ---------------------------------------------------------------------------

describe('sanitizeInclude', () => {
  it('undefined 输入应返回 undefined', () => {
    expect(sanitizeInclude(undefined, orderModelMeta)).toBeUndefined();
  });

  it('合法的单层 include 应通过', () => {
    const result = sanitizeInclude({ partner: true }, orderModelMeta);
    expect(result).toEqual({ partner: true });
  });

  it('合法的两层嵌套 include 应通过（depth=2）', () => {
    const result = sanitizeInclude(
      { items: { include: { product: true } } },
      orderModelMeta,
    );
    expect(result).toEqual({ items: { include: { product: true } } });
  });

  it('超过 MAX_INCLUDE_DEPTH=2 应抛异常', () => {
    const deepInclude = {
      items: {
        include: {
          order: {
            include: {
              partner: true,
            },
          },
        },
      },
    };

    expect(() => sanitizeInclude(deepInclude, orderModelMeta)).toThrow(
      BadRequestException,
    );
  });

  it('包含不存在的字段应抛异常', () => {
    expect(() =>
      sanitizeInclude({ nonexistentRelation: true }, orderModelMeta),
    ).toThrow(BadRequestException);
  });

  it('include 非关联字段（scalar）应抛异常', () => {
    // 'status' is a scalar field, not a relation
    const scalarModel: DmmfModelMeta = {
      name: 'Order',
      fields: [
        { name: 'status', kind: 'scalar', type: 'String', isList: false },
        { name: 'partner', kind: 'object', type: 'Partner', isList: false },
      ],
    };
    expect(() => sanitizeInclude({ status: true }, scalarModel)).toThrow(
      BadRequestException,
    );
  });

  it('无 modelMeta 时应放行（不做校验）', () => {
    const result = sanitizeInclude({ anything: true }, undefined);
    expect(result).toEqual({ anything: true });
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilter
// ---------------------------------------------------------------------------

describe('sanitizeFilter', () => {
  it('空 filter 应返回空对象', () => {
    expect(sanitizeFilter({}, orderModelMeta)).toEqual({});
  });

  it('合法 scalar 字段应通过', () => {
    const result = sanitizeFilter({ status: 'DRAFT' }, orderModelMeta);
    expect(result).toEqual({ status: 'DRAFT' });
  });

  it('不存在的字段应抛异常', () => {
    expect(() =>
      sanitizeFilter({ hackerField: 'drop table' }, orderModelMeta),
    ).toThrow(BadRequestException);
  });

  it('Prisma 逻辑操作符 AND/OR/NOT 应递归校验内部字段', () => {
    const result = sanitizeFilter(
      {
        AND: [{ status: 'DRAFT' }, { companyId: 'c1' }],
        OR: [{ partnerId: 'p1' }],
      },
      orderModelMeta,
    );
    expect(result).toEqual({
      AND: [{ status: 'DRAFT' }, { companyId: 'c1' }],
      OR: [{ partnerId: 'p1' }],
    });
  });

  it('AND 内部包含非法字段应抛异常', () => {
    expect(() =>
      sanitizeFilter({ AND: [{ evilField: 'x' }] }, orderModelMeta),
    ).toThrow(BadRequestException);
  });

  it('关联字段 filter 应放行（Prisma 中间件负责租户隔离）', () => {
    const result = sanitizeFilter(
      { partner: { name: 'Test' } },
      orderModelMeta,
    );
    expect(result).toEqual({ partner: { name: 'Test' } });
  });

  it('无 modelMeta 时应放行', () => {
    const result = sanitizeFilter({ anything: 'value' }, undefined);
    expect(result).toEqual({ anything: 'value' });
  });
});

// ---------------------------------------------------------------------------
// sanitizeOrderBy
// ---------------------------------------------------------------------------

describe('sanitizeOrderBy', () => {
  it('undefined 输入应返回 undefined', () => {
    expect(sanitizeOrderBy(undefined, orderModelMeta)).toBeUndefined();
  });

  it('合法 scalar 排序应通过', () => {
    const result = sanitizeOrderBy({ createdAt: 'desc' }, orderModelMeta);
    expect(result).toEqual({ createdAt: 'desc' });
  });

  it('数组形式的排序应逐项校验', () => {
    const result = sanitizeOrderBy(
      [{ status: 'asc' }, { totalAmount: 'desc' }],
      orderModelMeta,
    );
    expect(result).toEqual([{ status: 'asc' }, { totalAmount: 'desc' }]);
  });

  it('不存在的字段应抛异常', () => {
    expect(() =>
      sanitizeOrderBy({ nonExistentField: 'asc' }, orderModelMeta),
    ).toThrow(BadRequestException);
  });

  it('关联字段排序应抛异常', () => {
    const modelWithRelation: DmmfModelMeta = {
      name: 'Order',
      fields: [
        { name: 'id', kind: 'scalar', type: 'String', isList: false },
        { name: 'partner', kind: 'object', type: 'Partner', isList: false },
      ],
    };
    expect(() =>
      sanitizeOrderBy({ partner: 'asc' }, modelWithRelation),
    ).toThrow(BadRequestException);
  });

  it('无 modelMeta 时应放行', () => {
    const result = sanitizeOrderBy({ anything: 'asc' }, undefined);
    expect(result).toEqual({ anything: 'asc' });
  });
});

// ---------------------------------------------------------------------------
// getDmmfModel
// ---------------------------------------------------------------------------

describe('getDmmfModel', () => {
  it('应从 PrismaClient 的 _runtimeDataModel 中提取模型元数据', () => {
    const mockPrisma = {
      _runtimeDataModel: {
        models: {
          Order: { name: 'Order', fields: [] },
        },
      },
    };
    const result = getDmmfModel(mockPrisma, 'Order');
    expect(result).toEqual({ name: 'Order', fields: [] });
  });

  it('不存在的模型应返回 undefined', () => {
    const mockPrisma = {
      _runtimeDataModel: { models: {} },
    };
    expect(getDmmfModel(mockPrisma, 'NonExistent')).toBeUndefined();
  });

  it('无 _runtimeDataModel 时应返回 undefined', () => {
    expect(getDmmfModel({}, 'Order')).toBeUndefined();
  });

  it('null 输入应返回 undefined', () => {
    expect(getDmmfModel(null, 'Order')).toBeUndefined();
  });
});
