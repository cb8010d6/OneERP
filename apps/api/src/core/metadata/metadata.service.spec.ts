import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetadataService } from './metadata.service';
import { getResourcePolicy } from '../crud/crud-access-policy';

// Check the schemas against generated Prisma metadata so a setup link cannot
// expose a nonexistent field or the invalid default sort that blocked materials.
describe('first-company setup metadata', () => {
  const prisma = {
    customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new MetadataService(prisma as unknown as PrismaService);

  it.each([
    ['stockLocation', 'StockLocation'],
    ['material', 'Material'],
  ])(
    '%s uses existing scalar fields and a company-scoped model',
    async (resource, modelName) => {
      const schema = await service.getSchema(resource, 'company-a');
      const model = Prisma.dmmf.datamodel.models.find(
        (item) => item.name === modelName,
      );
      if (!model) throw new Error(`Missing Prisma model: ${modelName}`);
      const scalarNames = model.fields
        .filter((field) => field.kind !== 'object')
        .map((field) => field.name);
      expect(
        model.fields.find((field) => field.name === 'companyId'),
      ).toBeDefined();
      expect(schema.companyScoped).toBe(true);
      for (const field of schema.fields)
        expect(scalarNames).toContain(field.name);
      for (const field of Object.keys(schema.views.list.defaultSort ?? {}))
        expect(scalarNames).toContain(field);
    },
  );

  it('exposes only name/code for first internal location creation', async () => {
    const schema = await service.getSchema('stockLocation', 'company-a');
    expect(schema.fields.map((field) => field.name)).toEqual(['name', 'code']);
    expect(schema.fields.every((field) => field.required)).toBe(true);
    expect(schema.views.form.fields).toEqual(['name', 'code']);
    expect(schema.fields.some((field) => field.type === 'reference')).toBe(
      false,
    );
    const model = Prisma.dmmf.datamodel.models.find(
      (item) => item.name === 'StockLocation',
    );
    if (!model) throw new Error('Missing Prisma model: StockLocation');
    expect(model.fields.find((field) => field.name === 'usage')?.default).toBe(
      'INTERNAL',
    );
    expect(
      model.fields.find((field) => field.name === 'isActive')?.default,
    ).toBe(true);
    expect(
      model.fields.find((field) => field.name === 'warehouseId')?.isRequired,
    ).toBe(false);
  });

  it('requires material category and sorts by an available field', async () => {
    const schema = await service.getSchema('material', 'company-a');
    expect(
      schema.fields.find((field) => field.name === 'category')?.required,
    ).toBe(true);
    expect(schema.views.list.defaultSort).toEqual({ name: 'asc' });
  });
});

describe('generic write controls in metadata', () => {
  const prisma = {
    customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new MetadataService(prisma as unknown as PrismaService);

  it.each([
    'order',
    'purchaseOrder',
    'purchaseReceipt',
    'purchaseInvoice',
    'stockQuant',
    'workOrder',
    'invoice',
    'fileRecord',
  ])(
    'keeps %s readable without advertising generic edits',
    async (modelName) => {
      expect(getResourcePolicy(modelName).writable).toBe(false);
      const schema = await service.getSchema(modelName, 'company-a');
      expect(schema.allowGenericWrite).toBe(false);
      expect(schema.views.list.columns.length).toBeGreaterThan(0);
    },
  );

  it('does not advertise generic employee-role writes', async () => {
    expect(getResourcePolicy.bind(null, 'userCompanyRole')).toThrow();
    const schema = await service.getSchema('userCompanyRole', 'company-a');
    expect(schema.allowGenericWrite).toBe(false);
  });

  it.each([
    [
      'order',
      'reverseSaleShipment',
      '/inventory/posting/sale-order/{id}/reverse',
    ],
    [
      'purchaseOrder',
      'reversePurchaseInbound',
      '/inventory/posting/purchase/{purchaseNo}/reverse',
    ],
  ])(
    'preserves the dedicated correction action for %s',
    async (modelName, actionName, endpoint) => {
      const schema = await service.getSchema(modelName, 'company-a');
      expect(schema.allowGenericWrite).toBe(false);
      expect(schema.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: actionName,
            kind: 'correction',
            endpoint,
            permission: 'inventory:post',
          }),
        ]),
      );
    },
  );

  it.each([
    'partner',
    'material',
    'product',
    'stockLocation',
    'department',
    'taxCode',
  ])('preserves supported master-data editing for %s', async (modelName) => {
    expect(getResourcePolicy(modelName).writable).toBe(true);
    expect(
      (await service.getSchema(modelName, 'company-a')).allowGenericWrite,
    ).not.toBe(false);
  });
});
