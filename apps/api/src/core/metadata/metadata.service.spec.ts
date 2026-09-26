import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetadataService } from './metadata.service';

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
