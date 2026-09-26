import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CrudService } from './crud.service';
import { CrudHookContext } from './crud-hooks.service';

// Constructing the generated client provides real DMMF without a DB connection.
const metadataClient = new PrismaClient();
const runtimeDataModel = (
  metadataClient as unknown as {
    _runtimeDataModel: { models: Record<string, unknown> };
  }
)._runtimeDataModel;
afterAll(() => metadataClient.$disconnect());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDelegate() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest
      .fn()
      .mockResolvedValue({ id: 'reference', companyId: 'c1' }),
    create: jest.fn().mockResolvedValue({ id: 'new-id' }),
    update: jest.fn().mockResolvedValue({ id: 'updated-id' }),
    delete: jest.fn().mockResolvedValue({ id: 'deleted-id' }),
  };
}

function createMockPrisma(
  modelDelegate: ReturnType<typeof createMockDelegate>,
) {
  const prisma = {
    $transaction: jest.fn(),
    ...Object.fromEntries(
      Object.keys(runtimeDataModel.models).map((name) => [
        name.charAt(0).toLowerCase() + name.slice(1),
        modelDelegate,
      ]),
    ),
    _runtimeDataModel: runtimeDataModel,
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
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
    execute: jest.fn((_e: string, ctx: CrudHookContext) =>
      Promise.resolve(ctx),
    ),
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
  return { service, delegate, metadata, prisma, hooks, audit };
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

  it('缺少 companyId 时必须拒绝', async () => {
    const { service, delegate } = buildService();

    await expect(service.list('partner', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it('filter 中不同 companyId 不能覆盖当前租户', async () => {
    const { service, delegate } = buildService();

    await service.list(
      'partner',
      { filter: JSON.stringify({ companyId: 'c2' }) },
      'c1',
    );
    expect(delegate.count).toHaveBeenCalledWith({
      where: { AND: [{ companyId: 'c1' }, { companyId: 'c2' }] },
    });
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

  it.each([
    ['purchaseOrder', { supplierId: 's1' }],
    ['purchaseOrderLine', { purchaseOrderId: 'po1' }],
    ['purchaseReceipt', { purchaseOrderId: 'po1' }],
    ['purchaseReceiptLine', { purchaseReceiptId: 'gr1' }],
    ['purchaseInvoice', { purchaseOrderId: 'po1' }],
  ])('%s 写入必须走采购专用接口', async (model, data) => {
    const { service } = buildService();

    await expect(service.create(model, data, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.update(model, 'id1', data, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(model, 'id1', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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

describe('CrudService – sensitive resource boundary with generated Prisma metadata', () => {
  it.each([
    'user',
    'role',
    'userCompanyRole',
    'userInvitation',
    'company',
    'aiProviderSetting',
    'auditLog',
    'eventDlq',
  ])(
    'rejects every generic operation on %s before database access',
    async (name) => {
      const { service, delegate } = buildService();
      await expect(service.list(name, {}, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.findOne(name, 'id', {}, 'c1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.create(name, {}, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.update(name, 'id', {}, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.remove(name, 'id', 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      for (const method of Object.values(delegate))
        expect(method).not.toHaveBeenCalled();
    },
  );

  it.each([
    { include: JSON.stringify({ salesPerson: true }) },
    {
      fields: JSON.stringify({
        salesPerson: { select: { passwordHash: true } },
      }),
    },
    { fields: JSON.stringify(['id', 'salesPerson']) },
    { include: JSON.stringify({ partner: { include: { company: true } } }) },
    {
      include: JSON.stringify({
        partner: { select: { company: { select: { users: true } } } },
      }),
    },
    { fields: JSON.stringify({ partner: { include: { company: true } } }) },
    {
      include: JSON.stringify({
        partner: { where: { company: { users: { some: {} } } } },
      }),
    },
    {
      include: JSON.stringify({
        _count: {
          select: {
            items: {
              where: { order: { salesPerson: { passwordHash: 'probe' } } },
            },
          },
        },
      }),
    },
  ])(
    'rejects sensitive projection/traversal in list and detail: %j',
    async (query) => {
      const { service, delegate } = buildService();
      await expect(service.list('order', query, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.findOne('order', 'o1', query, 'c1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(delegate.findMany).not.toHaveBeenCalled();
      expect(delegate.findFirst).not.toHaveBeenCalled();
      expect(delegate.count).not.toHaveBeenCalled();
    },
  );

  it.each([
    { salesPerson: { passwordHash: { startsWith: 'probe' } } },
    {
      AND: [
        {
          items: {
            some: {
              order: { is: { salesPerson: { is: { email: 'probe' } } } },
            },
          },
        },
      ],
    },
    { partner: { isNot: { company: { id: 'other-company' } } } },
  ])(
    'rejects relation filters that reveal sensitive records: %j',
    async (filter) => {
      const { service, delegate } = buildService();
      await expect(
        service.list('order', { filter: JSON.stringify(filter) }, 'c1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(delegate.findMany).not.toHaveBeenCalled();
      expect(delegate.count).not.toHaveBeenCalled();
    },
  );

  it('rejects sensitive searchFields', async () => {
    const { service, delegate } = buildService();
    await expect(
      service.list(
        'order',
        { search: 'probe', searchFields: '["salesPerson"]' },
        'c1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it('preserves partner/product scalar lookups and business relation projections', async () => {
    const { service, delegate } = buildService({
      companyScopedModels: new Set(['partner', 'product', 'order']),
    });
    await service.list('partner', { fields: 'id,name' }, 'c1');
    expect(delegate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1' },
        select: { id: true, name: true },
      }),
    );
    const include = {
      category: true,
      material: { select: { id: true, name: true } },
    };
    await service.list('product', { include: JSON.stringify(include) }, 'c1');
    expect(delegate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ include }),
    );
    await service.list(
      'order',
      {
        include: JSON.stringify({
          partner: true,
          taxCode: true,
          items: { include: { taxCode: true } },
        }),
        filter: JSON.stringify({ partner: { is: { name: 'customer' } } }),
      },
      'c1',
    );
    expect(delegate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array) as unknown,
        }) as unknown,
      }),
    );
  });

  it('preserves explicit business relation counts and count filters', async () => {
    const { service, delegate } = buildService();
    const include = {
      _count: { select: { items: { where: { quantity: { gt: 0 } } } } },
    };
    await service.list('order', { include: JSON.stringify(include) }, 'c1');
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          _count: {
            select: {
              items: {
                where: {
                  order: { is: { companyId: 'c1' } },
                  quantity: { gt: 0 },
                },
              },
            },
          },
        },
      }),
    );
  });

  it.each([
    { company: { update: { name: 'changed' } } },
    {
      orders: {
        create: { salesPerson: { update: { passwordHash: 'changed' } } },
      },
    },
    { orders: { updateMany: { where: {}, data: { status: 'APPROVED' } } } },
    { company: { connect: { id: 'c2' } } },
    {
      company: {
        connectOrCreate: { where: { id: 'c2' }, create: { name: 'new' } },
      },
    },
  ])(
    'rejects nested generic writes before hooks and database access: %j',
    async (data) => {
      const { service, delegate, hooks } = buildService();
      await expect(
        service.create('partner', data, 'c1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.update('partner', 'p1', data, 'c1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(hooks.execute).not.toHaveBeenCalled();
      expect(delegate.findFirst).not.toHaveBeenCalled();
      expect(delegate.create).not.toHaveBeenCalled();
      expect(delegate.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    { companyId: 'c2' },
    { companyId: { set: 'c2' } },
    { id: 'other-id' },
    { id: { set: 'other-id' } },
  ])('rejects tenant/record identity changes: %j', async (data) => {
    const { service, delegate } = buildService();
    await expect(
      service.update('partner', 'p1', data, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it.each(['create', 'update'] as const)(
    'validates %s data again after hooks',
    async (operation) => {
      const { service, delegate, hooks } = buildService();
      delegate.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
      hooks.execute.mockImplementation((_event, ctx) =>
        Promise.resolve({
          ...ctx,
          data: { company: { update: { name: 'changed' } } },
        }),
      );
      const result =
        operation === 'create'
          ? service.create('partner', { name: 'safe' }, 'c1')
          : service.update('partner', 'p1', { name: 'safe' }, 'c1');
      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      expect(delegate.create).not.toHaveBeenCalled();
      expect(delegate.update).not.toHaveBeenCalled();
    },
  );

  it('rejects tenant reassignment independently of editable UI metadata', async () => {
    const { service, delegate } = buildService({
      companyScopedModels: new Set(),
    });
    await expect(
      service.update('partner', 'p1', { companyId: 'c2' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.findFirst).not.toHaveBeenCalled();
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it('rejects tenant reassignment introduced by a hook', async () => {
    const { service, delegate, hooks } = buildService({
      companyScopedModels: new Set(),
    });
    delegate.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    hooks.execute.mockImplementation((_event, ctx) =>
      Promise.resolve({ ...ctx, data: { companyId: 'c2' } }),
    );
    await expect(
      service.update('partner', 'p1', { name: 'safe' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it('preserves scalar reference writes and JSON fields', async () => {
    const { service, delegate } = buildService({
      companyScopedModels: new Set(['product']),
    });
    delegate.findFirst.mockResolvedValue({ id: 'p1', companyId: 'c1' });
    const data = {
      name: 'product',
      categoryId: 'category-id',
      materialId: 'material-id',
      customAttributes: { company: { name: 'plain JSON' } },
    };
    await service.update('product', 'p1', data, 'c1');
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'p1', companyId: 'c1' },
      data: { ...data, companyId: 'c1' },
    });
  });

  it('fails closed if generated model metadata is unavailable', async () => {
    const { service, delegate, prisma } = buildService();
    prisma._runtimeDataModel = { models: {} };
    await expect(service.list('partner', {}, 'c1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(delegate.findMany).not.toHaveBeenCalled();
  });
});

describe('CrudService – explicit ownership and final transaction boundary', () => {
  it.each([
    ['bomLine', 'bom'],
    ['journalEntryLine', 'journalEntry'],
    ['stockQuant', 'location'],
    ['orderItem', 'order'],
    ['purchaseOrderLine', 'purchaseOrder'],
    ['purchaseReceiptLine', 'receipt'],
    ['inventoryReturnLine', 'returnDocument'],
  ])(
    'scopes %s through its registered parent without UI metadata',
    async (name, parent) => {
      const { service, delegate, metadata } = buildService({
        companyScopedModels: new Set(),
      });
      await service.list(name, {}, 'c1');
      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { [parent]: { is: { companyId: 'c1' } } },
        }),
      );
      expect(delegate.count).toHaveBeenCalledWith({
        where: { [parent]: { is: { companyId: 'c1' } } },
      });
      expect(metadata.isCompanyScoped).not.toHaveBeenCalled();
    },
  );

  it.each([
    'invoice',
    'workOrder',
    'stockQuant',
    'fileRecord',
    'journalEntry',
    'journalEntryLine',
    'journal',
    'inventoryTransaction',
  ])('rejects lifecycle writes to %s', async (name) => {
    const { service, delegate } = buildService();
    await expect(service.create(name, {}, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.update(name, 'id', {}, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove(name, 'id', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    'documentSequence',
    'customFieldDefinition',
    'workflow',
    'workflowState',
    'workflowTransition',
  ])('does not expose unsupported/control model %s', async (name) => {
    const { service, delegate } = buildService();
    await expect(service.list(name, {}, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['product', 'categoryId'],
    ['product', 'materialId'],
    ['stockLocation', 'warehouseId'],
    ['stockLocation', 'parentId'],
    ['productCategory', 'parentId'],
    ['bom', 'productId'],
    ['bomLine', 'bomId'],
    ['bomLine', 'materialId'],
    ['taxCode', 'accountId'],
    ['account', 'parentId'],
  ])(
    'rejects foreign scalar %s.%s on create/update after hooks',
    async (name, field) => {
      const { service, delegate, hooks } = buildService();
      delegate.findFirst.mockResolvedValue({ id: 'id', companyId: 'c1' });
      delegate.findUnique.mockResolvedValue({ id: 'foreign', companyId: 'c2' });
      hooks.execute.mockImplementation((event, ctx) =>
        Promise.resolve(
          ['beforeInsert', 'beforeUpdate'].includes(event)
            ? { ...ctx, data: { ...ctx.data, [field]: 'foreign' } }
            : ctx,
        ),
      );
      await expect(service.create(name, {}, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.update(name, 'id', {}, 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(delegate.create).not.toHaveBeenCalled();
      expect(delegate.update).not.toHaveBeenCalled();
    },
  );

  it.each(['product', 'bomLine'])(
    'preserves shared Material reference on %s but scopes root Material reads',
    async (name) => {
      const { service, delegate } = buildService();
      delegate.findUnique.mockResolvedValue({ id: 'global', companyId: null });
      await service.create(name, { materialId: 'global' }, 'c1');
      expect(delegate.findUnique).toHaveBeenCalledWith({
        where: { id: 'global' },
      });
      expect(delegate.create).toHaveBeenCalled();
      await service.list('material', {}, 'c1');
      expect(delegate.count).toHaveBeenLastCalledWith({
        where: { companyId: 'c1' },
      });
    },
  );

  it('preserves nullable references and ordinary JSON without accepting FK operation envelopes', async () => {
    const { service, delegate } = buildService();
    await service.create(
      'product',
      {
        materialId: null,
        categoryId: null,
        customAttributes: { set: 'plain JSON' },
      },
      'c1',
    );
    expect(delegate.findUnique).not.toHaveBeenCalled();
    delegate.create.mockClear();
    await expect(
      service.create('product', { materialId: { set: 'foreign' } }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('uses the transaction client for final FK checks and mutation, including unchanged corrupt references', async () => {
    const { service, prisma, delegate } = buildService();
    const txDelegate = createMockDelegate();
    const tx = createMockPrisma(txDelegate);
    delegate.findFirst.mockResolvedValue({
      id: 'p1',
      companyId: 'c1',
      materialId: 'safe',
    });
    txDelegate.findFirst.mockResolvedValue({
      id: 'p1',
      companyId: 'c1',
      materialId: 'foreign',
    });
    txDelegate.findUnique.mockResolvedValue({ id: 'foreign', companyId: 'c2' });
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    await expect(
      service.update('product', 'p1', { name: 'update' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(txDelegate.findUnique).toHaveBeenCalledWith({
      where: { id: 'foreign' },
    });
    expect(delegate.findUnique).not.toHaveBeenCalled();
    expect(delegate.update).not.toHaveBeenCalled();
    expect(txDelegate.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rechecks ownership after hooks and carries child scope to final update/delete', async () => {
    const { service, prisma, delegate } = buildService();
    const txDelegate = createMockDelegate();
    const tx = createMockPrisma(txDelegate);
    delegate.findFirst.mockResolvedValue({ id: 'line', bomId: 'bom' });
    txDelegate.findFirst.mockResolvedValue({ id: 'line', bomId: 'bom' });
    prisma.$transaction.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    const where = { id: 'line', bom: { is: { companyId: 'c1' } } };
    await service.update('bomLine', 'line', { quantity: 2 }, 'c1');
    expect(txDelegate.update).toHaveBeenCalledWith({
      where,
      data: { quantity: 2 },
    });
    await service.remove('bomLine', 'line', 'c1');
    expect(txDelegate.delete).toHaveBeenCalledWith({ where });
    txDelegate.findFirst.mockResolvedValue(null);
    txDelegate.update.mockClear();
    txDelegate.delete.mockClear();
    await expect(
      service.update('bomLine', 'line', {}, 'c1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.remove('bomLine', 'line', 'c1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(txDelegate.update).not.toHaveBeenCalled();
    expect(txDelegate.delete).not.toHaveBeenCalled();
  });

  it('does not retry a failed transaction or emit success audit/after hooks', async () => {
    const { service, prisma, audit, hooks } = buildService();
    const failure = new Error('transaction conflict');
    prisma.$transaction.mockRejectedValue(failure);
    await expect(
      service.create('partner', { name: 'customer' }, 'c1'),
    ).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.logCrudAction).not.toHaveBeenCalled();
    expect(hooks.execute).not.toHaveBeenCalledWith(
      'afterInsert',
      expect.anything(),
    );
  });

  it('refuses a referenced master delete and retains unscoped inverse guards in the final deletion', async () => {
    const { service, delegate } = buildService();
    const owned = { id: 'category', companyId: 'c1' };
    delegate.findFirst
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(null);
    await expect(
      service.remove('productCategory', 'category', 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegate.delete).not.toHaveBeenCalled();
    delegate.findFirst.mockResolvedValue(owned);
    await service.remove('productCategory', 'category', 'c1');
    expect(delegate.delete).toHaveBeenCalledWith({
      where: {
        id: 'category',
        companyId: 'c1',
        children: { none: {} },
        products: { none: {} },
      },
    });
  });
});
