import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CrudService } from './crud.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDelegate() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'new-id' }),
    update: jest.fn().mockResolvedValue({ id: 'updated-id' }),
    delete: jest.fn().mockResolvedValue({ id: 'deleted-id' }),
  };
}

function createMockPrisma(
  modelDelegate: ReturnType<typeof createMockDelegate>,
) {
  return {
    order: modelDelegate,
    partner: modelDelegate,
    _runtimeDataModel: {
      models: {
        order: {
          name: 'Order',
          fields: [
            { name: 'id', kind: 'scalar', type: 'String', isList: false },
            { name: 'orderNo', kind: 'scalar', type: 'String', isList: false },
            {
              name: 'partnerId',
              kind: 'scalar',
              type: 'String',
              isList: false,
            },
            {
              name: 'companyId',
              kind: 'scalar',
              type: 'String',
              isList: false,
            },
            { name: 'status', kind: 'scalar', type: 'String', isList: false },
            {
              name: 'totalAmount',
              kind: 'scalar',
              type: 'Float',
              isList: false,
            },
            { name: 'partner', kind: 'object', type: 'Partner', isList: false },
            { name: 'items', kind: 'object', type: 'OrderItem', isList: true },
          ],
        },
        partner: {
          name: 'Partner',
          fields: [
            { name: 'id', kind: 'scalar', type: 'String', isList: false },
            { name: 'name', kind: 'scalar', type: 'String', isList: false },
            {
              name: 'companyId',
              kind: 'scalar',
              type: 'String',
              isList: false,
            },
            { name: 'company', kind: 'object', type: 'Company', isList: false },
          ],
        },
      },
    },
  };
}

function createMockMetadataService(
  companyScoped = new Set(['order', 'partner']),
) {
  return {
    isCompanyScoped: jest.fn((m: string) => companyScoped.has(m)),
    getSchema: jest.fn().mockRejectedValue(new Error('not found')),
    validateCustomAttributes: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockHooksService() {
  return {
    execute: jest.fn((_e: string, ctx: unknown) => Promise.resolve(ctx)),
  };
}

function createMockAuditService() {
  return { logCrudAction: jest.fn().mockResolvedValue(undefined) };
}

function buildService(deps?: { companyScopedModels?: Set<string> }) {
  const delegate = createMockDelegate();
  const prisma = createMockPrisma(delegate);
  const metadata = createMockMetadataService(deps?.companyScopedModels);
  const hooks = createMockHooksService();
  const audit = createMockAuditService();
  const service = new CrudService(
    prisma as never,
    metadata as never,
    hooks as never,
    audit as never,
  );
  return { service, delegate, metadata };
}

// ---------------------------------------------------------------------------
// 租户隔离 – list()
// ---------------------------------------------------------------------------

describe('CrudService – 租户隔离: list()', () => {
  it('应自动注入 companyId 到 where 子句', async () => {
    const { service, delegate } = buildService();
    delegate.findMany.mockResolvedValue([{ id: '1', companyId: 'c1' }]);
    delegate.count.mockResolvedValue(1);

    await service.list('partner', {}, 'c1');

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'c1' }) as unknown,
      }),
    );
  });

  it('不传 companyId 时不注入', async () => {
    const { service, delegate } = buildService();

    await service.list('partner', {});

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('filter 中包含不同 companyId 应抛 ForbiddenException', async () => {
    const { service } = buildService();

    await expect(
      service.list(
        'partner',
        { filter: JSON.stringify({ companyId: 'c2' }) },
        'c1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 租户隔离 – findOne()
// ---------------------------------------------------------------------------

describe('CrudService – 租户隔离: findOne()', () => {
  it('应注入 companyId 到 where 子句', async () => {
    const { service, delegate } = buildService();
    const record = { id: 'r1', companyId: 'c1' };
    delegate.findFirst.mockResolvedValue(record);

    const result = await service.findOne('partner', 'r1', {}, 'c1');

    expect(result).toEqual(record);
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'r1',
          companyId: 'c1',
        }) as unknown,
      }),
    );
  });

  it('查询不存在或属于其他租户的记录应抛 NotFoundException', async () => {
    const { service, delegate } = buildService();
    delegate.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('partner', 'r1', {}, 'c1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// 租户隔离 – create()
// ---------------------------------------------------------------------------

describe('CrudService – 租户隔离: create()', () => {
  it('应自动注入 companyId 到 data', async () => {
    const { service, delegate } = buildService();
    delegate.create.mockResolvedValue({ id: 'new1', companyId: 'c1' });

    await service.create('partner', { name: 'test' }, 'c1');

    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'c1' }) as unknown,
      }),
    );
  });

  it('客户端传入不同 companyId 应抛 ForbiddenException', async () => {
    const { service } = buildService();

    await expect(
      service.create('partner', { companyId: 'other', name: 'test' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 租户隔离 – update()
// ---------------------------------------------------------------------------

describe('CrudService – 租户隔离: update()', () => {
  it('应注入 companyId 到 findFirst 的 where 中', async () => {
    const { service, delegate } = buildService();
    delegate.findFirst.mockResolvedValue({ id: 'r1', companyId: 'c1' });
    delegate.update.mockResolvedValue({ id: 'r1', name: 'updated' });

    await service.update('partner', 'r1', { name: 'updated' }, 'c1');

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'r1',
          companyId: 'c1',
        }) as unknown,
      }),
    );
  });

  it('更新不存在或其他租户的记录应抛 NotFoundException', async () => {
    const { service, delegate } = buildService();
    delegate.findFirst.mockResolvedValue(null);

    await expect(
      service.update('partner', 'r1', { name: 'x' }, 'c1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// 租户隔离 – remove()
// ---------------------------------------------------------------------------

describe('CrudService – 租户隔离: remove()', () => {
  it('应注入 companyId 到 findFirst 的 where 中', async () => {
    const { service, delegate } = buildService();
    delegate.findFirst.mockResolvedValue({ id: 'r1', companyId: 'c1' });
    delegate.delete.mockResolvedValue({ id: 'r1' });

    await service.remove('partner', 'r1', 'c1');

    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'r1',
          companyId: 'c1',
        }) as unknown,
      }),
    );
  });

  it('删除不存在或其他租户的记录应抛 NotFoundException', async () => {
    const { service, delegate } = buildService();
    delegate.findFirst.mockResolvedValue(null);

    await expect(service.remove('partner', 'r1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ---------------------------------------------------------------------------
// 专用模型写入拦截
// ---------------------------------------------------------------------------

describe('CrudService – 专用模型写入拦截', () => {
  it('order 写入必须走订单专用接口', async () => {
    const { service } = buildService();

    await expect(
      service.create('order', { orderNo: 'SO-1' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update('order', 'o1', { totalAmount: 1 }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('order', 'o1', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('orderItem 写入必须走订单专用接口', async () => {
    const { service } = buildService();

    await expect(
      service.create('orderItem', { orderId: 'o1' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update('orderItem', 'oi1', { quantity: 1 }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.remove('orderItem', 'oi1', 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 未知模型
// ---------------------------------------------------------------------------

describe('CrudService – 未知模型', () => {
  it('请求不存在的模型应抛 BadRequestException', async () => {
    const { service } = buildService();

    await expect(service.list('nonexistent', {}, 'c1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
