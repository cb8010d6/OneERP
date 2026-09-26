import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CrudService } from '../../src/core/crud/crud.service';
import { CrudHooksService } from '../../src/core/crud/crud-hooks.service';
import { MetadataService } from '../../src/core/metadata/metadata.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { EventQueueService } from '../../src/core/events/event-queue.service';
import { TenantContext } from '../../src/core/tenant/tenant-context';

// Explicit disposable local database only. No URL or credentials are logged.
function requireTestDatabase() {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Integration tests require an explicit test DATABASE_URL');
  }
  if (
    process.env.ONEERP_INTEGRATION_TEST !== '1' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)
  ) {
    throw new Error(
      'Integration tests require ONEERP_INTEGRATION_TEST=1 and a local database ending in _test',
    );
  }
}
requireTestDatabase();

type Row = { id: string; [field: string]: unknown };

// These tests use the production Prisma middleware and real SQL, including
// intentionally malformed legacy cross-company FKs inserted outside CRUD.
// They do not mock delegates, query results, reference checks or transactions.
describe('PostgreSQL generic resource ownership', () => {
  const prisma = new PrismaService();
  let service: CrudService;
  let hooks: CrudHooksService;
  let companyA: string;
  let companyB: string;
  let globalMaterialId: string;
  let materialA: string;
  let materialB: string;
  let categoryA: string;
  let categoryB: string;
  let productA: string;
  let productB: string;
  let warehouseA: string;
  let warehouseB: string;
  let locationA: string;
  let locationB: string;
  let bomA: string;
  let bomB: string;
  let lineA: string;
  let lineB: string;
  let journalLineA: string;
  let journalLineB: string;

  const asA = <T>(work: () => T): T =>
    TenantContext.run({ companyId: companyA }, work);
  const ids = (rows: unknown[]) => rows.map((row) => (row as Row).id).sort();

  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    companyA = randomUUID();
    companyB = randomUUID();
    globalMaterialId = randomUUID();
    await prisma.company.createMany({
      data: [companyA, companyB].map((id) => ({
        id,
        name: 'Synthetic resource ownership',
      })),
    });
    const materials = await Promise.all(
      [companyA, companyB, null].map((companyId, index) =>
        prisma.material.create({
          data: {
            id: index === 2 ? globalMaterialId : randomUUID(),
            companyId,
            sku: randomUUID(),
            name:
              index === 1 ? 'FOREIGN_SECRET_MATERIAL' : 'Synthetic material',
            category: 'TEST',
          },
        }),
      ),
    );
    [materialA, materialB] = materials.map((row) => row.id);
    const categories = await Promise.all(
      [companyA, companyB].map((companyId) =>
        prisma.productCategory.create({
          data: {
            companyId,
            name:
              companyId === companyB
                ? 'FOREIGN_SECRET_CATEGORY'
                : 'Synthetic category',
          },
        }),
      ),
    );
    [categoryA, categoryB] = categories.map((row) => row.id);
    const products = await Promise.all(
      [companyA, companyB].map((companyId, index) =>
        prisma.product.create({
          data: {
            companyId,
            sku: randomUUID(),
            name: index === 1 ? 'FOREIGN_SECRET_PRODUCT' : 'Synthetic product',
            categoryId: categories[index].id,
            materialId: materials[index].id,
          },
        }),
      ),
    );
    [productA, productB] = products.map((row) => row.id);
    const warehouses = await Promise.all(
      [companyA, companyB].map((companyId) =>
        prisma.warehouse.create({
          data: { companyId, name: 'Synthetic warehouse', type: 'TEST' },
        }),
      ),
    );
    [warehouseA, warehouseB] = warehouses.map((row) => row.id);
    const locations = await Promise.all(
      [companyA, companyB].map((companyId, index) =>
        prisma.stockLocation.create({
          data: {
            companyId,
            name: 'Synthetic location',
            warehouseId: warehouses[index].id,
          },
        }),
      ),
    );
    [locationA, locationB] = locations.map((row) => row.id);
    const boms = await Promise.all(
      [companyA, companyB].map((companyId, index) =>
        prisma.bom.create({
          data: { companyId, productId: products[index].id },
        }),
      ),
    );
    [bomA, bomB] = boms.map((row) => row.id);
    const lines = await Promise.all(
      boms.map((bom, index) =>
        prisma.bomLine.create({
          data: { bomId: bom.id, materialId: materials[index].id, quantity: 1 },
        }),
      ),
    );
    [lineA, lineB] = lines.map((row) => row.id);
    const accountingLines = await Promise.all(
      [companyA, companyB].map(async (companyId) => {
        const account = await prisma.account.create({
          data: {
            companyId,
            code: 'TEST',
            name: 'Synthetic account',
            type: 'ASSET',
          },
        });
        const journal = await prisma.journal.create({
          data: { companyId, code: 'GEN', name: 'Synthetic journal' },
        });
        const entry = await prisma.journalEntry.create({
          data: {
            companyId,
            journalId: journal.id,
            entryNo: randomUUID(),
            date: new Date(),
            lines: { create: { accountId: account.id, lineNo: 1, debit: 10 } },
          },
          include: { lines: true },
        });
        return entry.lines[0];
      }),
    );
    [journalLineA, journalLineB] = accountingLines.map((row) => row.id);
    hooks = new CrudHooksService();
    service = new CrudService(
      prisma,
      new MetadataService(prisma),
      hooks,
      new AuditService(
        prisma,
        new EventQueueService(prisma, new EventEmitter2()),
      ),
    );
  });

  afterEach(async () => {
    if (!companyA) return;
    const companyId = { in: [companyA, companyB] };
    // Scoped fixture cleanup, including deliberately malformed references.
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { companyId } },
    });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.journal.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.bomLine.deleteMany({ where: { bom: { companyId } } });
    await prisma.bom.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.productCategory.updateMany({
      where: { companyId },
      data: { parentId: null },
    });
    await prisma.productCategory.deleteMany({ where: { companyId } });
    await prisma.stockLocation.updateMany({
      where: { companyId },
      data: { parentId: null },
    });
    await prisma.stockLocation.deleteMany({ where: { companyId } });
    await prisma.warehouse.deleteMany({ where: { companyId } });
    await prisma.material.deleteMany({
      where: { OR: [{ companyId }, { id: globalMaterialId }] },
    });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('preserves own master writes, nullable references and explicitly shared material references', async () => {
    await asA(() =>
      service.update(
        'product',
        productA,
        { materialId: globalMaterialId },
        companyA,
      ),
    );
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productA } }))
        .materialId,
    ).toBe(globalMaterialId);
    const expanded = (await asA(() =>
      service.findOne(
        'product',
        productA,
        { include: JSON.stringify({ material: true }) },
        companyA,
      ),
    )) as Row;
    expect((expanded.material as Row).id).toBe(globalMaterialId);
    await asA(() =>
      service.update(
        'product',
        productA,
        { materialId: null, categoryId: categoryA },
        companyA,
      ),
    );
    const created = (await asA(() =>
      service.create(
        'product',
        {
          sku: randomUUID(),
          name: 'Own new product',
          materialId: materialA,
          categoryId: categoryA,
        },
        companyA,
      ),
    )) as Row;
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: created.id } }))
        .companyId,
    ).toBe(companyA);
    const roots = await asA(() =>
      service.list(
        'material',
        { orderBy: JSON.stringify({ name: 'asc' }) },
        companyA,
      ),
    );
    expect(ids(roots.data)).toEqual([materialA]);
    await expect(
      asA(() =>
        service.update(
          'material',
          globalMaterialId,
          { name: 'Must remain shared' },
          companyA,
        ),
      ),
    ).rejects.toThrow();
  });

  it.each(['materialId', 'categoryId'])(
    'rejects foreign product %s on create, direct update and scalar set update',
    async (field) => {
      const foreignId = field === 'materialId' ? materialB : categoryB;
      await expect(
        asA(() =>
          service.create(
            'product',
            { sku: randomUUID(), name: 'Rejected', [field]: foreignId },
            companyA,
          ),
        ),
      ).rejects.toThrow();
      await expect(
        asA(() =>
          service.update('product', productA, { [field]: foreignId }, companyA),
        ),
      ).rejects.toThrow();
      await expect(
        asA(() =>
          service.update(
            'product',
            productA,
            { [field]: { set: foreignId } },
            companyA,
          ),
        ),
      ).rejects.toThrow();
      const persisted = await prisma.product.findUniqueOrThrow({
        where: { id: productA },
      });
      expect(persisted.materialId).toBe(materialA);
      expect(persisted.categoryId).toBe(categoryA);
      expect(
        await prisma.product.count({ where: { companyId: companyA } }),
      ).toBe(1);
    },
  );

  it('revalidates hook-mutated FK assignments before writing', async () => {
    hooks.register('beforeUpdate', 'product', (ctx) => ({
      data: { ...ctx.data, materialId: materialB },
    }));
    await expect(
      asA(() =>
        service.update('product', productA, { name: 'Still own' }, companyA),
      ),
    ).rejects.toThrow();
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productA } }))
        .materialId,
    ).toBe(materialA);
  });

  it('preserves same-tenant location references and rejects foreign warehouse or parent links', async () => {
    const child = (await asA(() =>
      service.create(
        'stockLocation',
        { name: 'Own child', warehouseId: warehouseA, parentId: locationA },
        companyA,
      ),
    )) as Row;
    for (const data of [
      { warehouseId: warehouseB },
      { parentId: locationB },
      { parentId: { set: locationB } },
    ]) {
      await expect(
        asA(() => service.update('stockLocation', child.id, data, companyA)),
      ).rejects.toThrow();
    }
    expect(
      (
        await prisma.stockLocation.findUniqueOrThrow({
          where: { id: child.id },
        })
      ).parentId,
    ).toBe(locationA);
  });

  it('scopes parent-owned BOM lines for reads, writes, deletes and reparenting', async () => {
    const own = await asA(() =>
      service.list(
        'bomLine',
        { orderBy: JSON.stringify({ id: 'asc' }) },
        companyA,
      ),
    );
    expect(ids(own.data)).toEqual([lineA]);
    expect(own.total).toBe(1);
    await expect(
      asA(() => service.findOne('bomLine', lineB, {}, companyA)),
    ).rejects.toThrow();
    await expect(
      asA(() => service.update('bomLine', lineB, { quantity: 2 }, companyA)),
    ).rejects.toThrow();
    await expect(
      asA(() => service.remove('bomLine', lineB, companyA)),
    ).rejects.toThrow();
    await expect(
      asA(() => service.update('bomLine', lineA, { bomId: bomB }, companyA)),
    ).rejects.toThrow();
    await expect(
      asA(() =>
        service.create(
          'bomLine',
          { bomId: bomB, materialId: materialA, quantity: 1 },
          companyA,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asA(() =>
        service.create(
          'bomLine',
          { bomId: bomA, materialId: materialB, quantity: 1 },
          companyA,
        ),
      ),
    ).rejects.toThrow();
    const created = (await asA(() =>
      service.create(
        'bomLine',
        { bomId: bomA, materialId: materialA, quantity: 2 },
        companyA,
      ),
    )) as Row;
    await asA(() =>
      service.update('bomLine', created.id, { quantity: 3 }, companyA),
    );
    expect(
      Number(
        (await prisma.bomLine.findUniqueOrThrow({ where: { id: created.id } }))
          .quantity,
      ),
    ).toBe(3);
    await asA(() => service.remove('bomLine', created.id, companyA));
    expect(
      await prisma.bomLine.findUnique({ where: { id: lineB } }),
    ).not.toBeNull();
  });

  it('preserves journal line reads through its parent and blocks all generic journal line writes', async () => {
    const result = await asA(() =>
      service.list(
        'journalEntryLine',
        {
          include: JSON.stringify({ account: true }),
          orderBy: JSON.stringify({ lineNo: 'asc' }),
        },
        companyA,
      ),
    );
    expect(ids(result.data)).toEqual([journalLineA]);
    expect(result.total).toBe(1);
    await expect(
      asA(() =>
        service.findOne('journalEntryLine', journalLineB, {}, companyA),
      ),
    ).rejects.toThrow();
    for (const id of [journalLineA, journalLineB]) {
      await expect(
        asA(() =>
          service.update('journalEntryLine', id, { debit: 999 }, companyA),
        ),
      ).rejects.toThrow();
      await expect(
        asA(() => service.remove('journalEntryLine', id, companyA)),
      ).rejects.toThrow();
    }
    expect(
      Number(
        (
          await prisma.journalEntryLine.findUniqueOrThrow({
            where: { id: journalLineA },
          })
        ).debit,
      ),
    ).toBe(10);
  });

  it('refuses missing tenant context and unregistered roots before data access', async () => {
    await expect(service.list('product', {})).rejects.toThrow();
    await expect(
      service.create('product', { sku: randomUUID(), name: 'No tenant' }),
    ).rejects.toThrow();
    await expect(
      asA(() => service.list('user', {}, companyA)),
    ).rejects.toThrow();
  });

  it.each(['include', 'fields'])(
    'excludes legacy cross-tenant to-one links from %s responses and total counts',
    async (projection) => {
      await prisma.product.update({
        where: { id: productA },
        data: { categoryId: categoryB, materialId: materialB },
      });
      const shape =
        projection === 'include'
          ? { category: true, material: true }
          : {
              id: true,
              category: { select: { id: true, name: true } },
              material: { select: { id: true, name: true } },
            };
      const result = await asA(() =>
        service.list(
          'product',
          { [projection]: JSON.stringify(shape) },
          companyA,
        ),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      await expect(
        asA(() =>
          service.findOne(
            'product',
            productA,
            { [projection]: JSON.stringify(shape) },
            companyA,
          ),
        ),
      ).rejects.toThrow();
    },
  );

  it('scopes reverse collection contents and relation counts despite malformed legacy links', async () => {
    await prisma.product.update({
      where: { id: productB },
      data: { categoryId: categoryA },
    });
    const category = (await asA(() =>
      service.findOne(
        'productCategory',
        categoryA,
        {
          include: JSON.stringify({
            products: true,
            _count: { select: { products: true } },
          }),
        },
        companyA,
      ),
    )) as Row;
    expect(ids(category.products as unknown[])).toEqual([productA]);
    expect(category._count).toEqual({ products: 1 });
    expect(JSON.stringify(category)).not.toContain('FOREIGN_SECRET_PRODUCT');
  });

  it.each([
    { operator: 'some', name: 'FOREIGN_SECRET_PRODUCT', expected: false },
    { operator: 'none', name: 'FOREIGN_SECRET_PRODUCT', expected: true },
    { operator: 'every', name: 'Synthetic product', expected: true },
  ])(
    'evaluates collection $operator using only tenant-owned children',
    async ({ operator, name, expected }) => {
      await prisma.product.update({
        where: { id: productB },
        data: { categoryId: categoryA },
      });
      const result = await asA(() =>
        service.list(
          'productCategory',
          {
            filter: JSON.stringify({
              id: categoryA,
              products: { [operator]: { name } },
            }),
          },
          companyA,
        ),
      );
      expect(ids(result.data)).toEqual(expected ? [categoryA] : []);
      expect(result.total).toBe(expected ? 1 : 0);
    },
  );

  it('keeps the parent while excluding nested children with foreign to-one projections and filtered counts', async () => {
    await prisma.product.update({
      where: { id: productA },
      data: { materialId: materialB },
    });
    const result = await asA(() =>
      service.list(
        'productCategory',
        {
          filter: JSON.stringify({ id: categoryA }),
          include: JSON.stringify({
            products: { include: { material: true } },
            _count: {
              select: {
                products: {
                  where: {
                    material: { is: { name: 'FOREIGN_SECRET_MATERIAL' } },
                  },
                },
              },
            },
          }),
        },
        companyA,
      ),
    );
    expect(ids(result.data)).toEqual([categoryA]);
    expect(result.total).toBe(1);
    const category = result.data[0] as Row;
    expect(category.products).toEqual([]);
    expect(category._count).toEqual({ products: 0 });
    expect(JSON.stringify(category)).not.toContain('FOREIGN_SECRET_MATERIAL');
  });

  it('refuses deletion of a master referenced only by a foreign legacy dependent and permits unreferenced deletion', async () => {
    await prisma.product.update({
      where: { id: productA },
      data: { categoryId: null },
    });
    await prisma.product.update({
      where: { id: productB },
      data: { categoryId: categoryA },
    });
    await expect(
      asA(() => service.remove('productCategory', categoryA, companyA)),
    ).rejects.toThrow();
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productB } }))
        .categoryId,
    ).toBe(categoryA);
    expect(
      await prisma.productCategory.findUnique({ where: { id: categoryA } }),
    ).not.toBeNull();
    const disposable = (await asA(() =>
      service.create(
        'productCategory',
        { name: 'Unreferenced synthetic category' },
        companyA,
      ),
    )) as Row;
    await asA(() => service.remove('productCategory', disposable.id, companyA));
    expect(
      await prisma.productCategory.findUnique({ where: { id: disposable.id } }),
    ).toBeNull();
  });

  it('does not reveal foreign category field values through NOT and OR relation predicates', async () => {
    await prisma.product.update({
      where: { id: productA },
      data: { categoryId: categoryB },
    });
    const queries = [
      { category: { is: { name: 'FOREIGN_SECRET_CATEGORY' } } },
      { NOT: { category: { is: { name: 'definitely-not-the-secret' } } } },
      {
        OR: [
          { category: { is: { name: 'FOREIGN_SECRET_CATEGORY' } } },
          { id: productB },
        ],
      },
      { category: { isNot: { name: 'definitely-not-the-secret' } } },
    ];
    for (const filter of queries) {
      const result = await asA(() =>
        service.list('product', { filter: JSON.stringify(filter) }, companyA),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    }
  });
});
