import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  getDmmfModel,
  sanitizeFilter,
  sanitizeInclude,
} from './crud-query-validator';
import {
  assertOwnedReferences,
  ownershipWhere,
  scopeResourceQuery,
  unreferencedWhere,
} from './crud-ownership';

const prisma = new PrismaClient();
const resolve = (name: string) => getDmmfModel(prisma, name);
const model = (name: string) => {
  const meta = resolve(name);
  if (!meta) throw new Error(`Missing generated metadata for ${name}`);
  return meta;
};
afterAll(() => prisma.$disconnect());

describe('CRUD ownership compiler with generated Prisma metadata', () => {
  it('keeps nullable and shared references while requiring ownership for present relations', () => {
    const result = scopeResourceQuery(model('Product'), 'c1', resolve, {
      where: { sku: 'own' },
      include: { material: true, category: true },
    });
    expect(result.include).toEqual({ material: true, category: true });
    expect(result.where).toEqual({
      AND: [
        { companyId: 'c1' },
        { sku: 'own' },
        {
          OR: [
            { material: null },
            {
              material: {
                is: { OR: [{ companyId: 'c1' }, { companyId: null }] },
              },
            },
          ],
        },
        { OR: [{ category: null }, { category: { is: { companyId: 'c1' } } }] },
      ],
    });
  });

  it('hoists to-one ownership outside user NOT and OR', () => {
    const filter = {
      OR: [{ sku: 'own' }, { NOT: { category: { isNot: { name: 'probe' } } } }],
    };
    const result = scopeResourceQuery(model('Product'), 'c1', resolve, {
      where: sanitizeFilter(filter, model('Product'), resolve),
    });
    expect(result.where).toEqual({
      AND: [
        { companyId: 'c1' },
        {
          OR: [
            { sku: 'own' },
            {
              NOT: { category: { isNot: { companyId: 'c1', name: 'probe' } } },
            },
          ],
        },
        { OR: [{ category: null }, { category: { is: { companyId: 'c1' } } }] },
      ],
    });
  });

  it.each(['some', 'none', 'every'])(
    'limits %s to authorized collection members',
    (operator) => {
      const result = scopeResourceQuery(
        model('ProductCategory'),
        'c1',
        resolve,
        {
          where: { products: { [operator]: { name: 'probe' } } },
        },
      );
      const ownedPredicate = { companyId: 'c1', name: 'probe' };
      expect(result.where).toEqual({
        companyId: 'c1',
        products: {
          [operator]:
            operator === 'every'
              ? { OR: [{ NOT: { companyId: 'c1' } }, ownedPredicate] }
              : ownedPredicate,
        },
      });
    },
  );

  it('keeps nested collection projection guards inside the collection and count filters scoped', () => {
    const include = {
      products: { include: { material: true } },
      _count: {
        select: { products: { where: { material: { name: 'probe' } } } },
      },
    };
    const result = scopeResourceQuery(model('ProductCategory'), 'c1', resolve, {
      where: {},
      include: sanitizeInclude(include, model('ProductCategory'), resolve),
    });
    expect(result.where).toEqual({ companyId: 'c1' });
    expect(result.include).toEqual({
      products: {
        select: undefined,
        include: { material: true },
        where: {
          companyId: 'c1',
          OR: [
            { material: null },
            {
              material: {
                is: { OR: [{ companyId: 'c1' }, { companyId: null }] },
              },
            },
          ],
        },
      },
      _count: {
        select: {
          products: {
            where: {
              companyId: 'c1',
              material: {
                is: {
                  OR: [{ companyId: 'c1' }, { companyId: null }],
                  name: 'probe',
                },
              },
              OR: [
                { material: null },
                {
                  material: {
                    is: { OR: [{ companyId: 'c1' }, { companyId: null }] },
                  },
                },
              ],
            },
          },
        },
      },
    });
  });

  it('expands _count:true into scoped known relation counts', () => {
    const result = scopeResourceQuery(model('ProductCategory'), 'c1', resolve, {
      where: {},
      include: sanitizeInclude(
        { _count: true },
        model('ProductCategory'),
        resolve,
      ),
    });
    expect(result.include).toEqual({
      _count: {
        select: {
          children: { where: { companyId: 'c1' } },
          products: { where: { companyId: 'c1' } },
        },
      },
    });
  });

  it('rejects a foreign pagination cursor before querying', () => {
    expect(() =>
      sanitizeInclude(
        { products: { cursor: { id: 'foreign' } } },
        model('ProductCategory'),
        resolve,
      ),
    ).toThrow(BadRequestException);
  });

  it('fails closed on missing tenant metadata and incorrect child owner paths', () => {
    const missingCompany = {
      ...model('Product'),
      fields: model('Product').fields.filter(
        (field) => field.name !== 'companyId',
      ),
    };
    expect(() => ownershipWhere(missingCompany, 'c1', resolve)).toThrow(
      BadRequestException,
    );
    const wrongParent = {
      ...model('BomLine'),
      fields: model('BomLine').fields.map((field) =>
        field.name === 'bom' ? { ...field, type: 'Material' } : field,
      ),
    };
    expect(() => ownershipWhere(wrongParent, 'c1', resolve)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a reference when runtime metadata cannot prove the lookup key is unique', async () => {
    const findUnique = jest.fn();
    const invalidMaterial = {
      ...model('Material'),
      fields: model('Material').fields.map((field) =>
        field.name === 'id'
          ? { ...field, isId: false, isUnique: false }
          : field,
      ),
    };
    await expect(
      assertOwnedReferences(
        { material: { findUnique } },
        model('Product'),
        { materialId: 'global' },
        'c1',
        (name) => (name === 'Material' ? invalidMaterial : resolve(name)),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('fails closed on incomplete FK metadata', async () => {
    const invalid = {
      ...model('Product'),
      fields: model('Product').fields.map((field) =>
        field.name === 'material'
          ? { ...field, relationFromFields: undefined }
          : field,
      ),
    };
    await expect(
      assertOwnedReferences(
        {},
        invalid,
        { materialId: 'foreign' },
        'c1',
        resolve,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks inverse dependencies without filtering out foreign or dedicated rows', () => {
    expect(unreferencedWhere(model('ProductCategory'), resolve)).toEqual({
      children: { none: {} },
      products: { none: {} },
    });
    expect(unreferencedWhere(model('Material'), resolve)).toEqual(
      expect.objectContaining({
        products: { none: {} },
        materialCosts: { none: {} },
      }),
    );
    expect(unreferencedWhere(model('BomLine'), resolve)).toEqual({});
  });
});
