import { NotFoundException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

type MockPrisma = {
  department: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

describe('DepartmentsService', () => {
  const prisma: MockPrisma = {
    department: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  let service: DepartmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DepartmentsService(
      prisma as unknown as ConstructorParameters<typeof DepartmentsService>[0],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a department', async () => {
      const expected = { id: 'd1', name: '研发部', companyId: 'c1' };
      prisma.department.create.mockResolvedValue(expected);

      const result = await service.create('c1', { name: '研发部' });

      expect(result).toEqual(expected);
      expect(prisma.department.create).toHaveBeenCalledWith({
        data: { name: '研发部', companyId: 'c1' },
      });
    });
  });

  describe('findAll', () => {
    it('should return departments for a company', async () => {
      const departments = [
        { id: 'd1', name: '研发部', companyId: 'c1' },
        { id: 'd2', name: '市场部', companyId: 'c1' },
      ];
      prisma.department.findMany.mockResolvedValue(departments);

      const result = await service.findAll('c1');

      expect(result).toEqual(departments);
      expect(prisma.department.findMany).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
      });
    });
  });

  describe('update', () => {
    it('should update an existing department', async () => {
      prisma.department.findFirst.mockResolvedValue({ id: 'd1', companyId: 'c1' });
      prisma.department.update.mockResolvedValue({ id: 'd1', name: '技术部', companyId: 'c1' });

      const result = await service.update('c1', 'd1', { name: '技术部' });

      expect(result.name).toBe('技术部');
      expect(prisma.department.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { name: '技术部' },
      });
    });

    it('should throw NotFoundException when department not found', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c1', 'nonexistent', { name: '技术部' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete an existing department', async () => {
      prisma.department.findFirst.mockResolvedValue({ id: 'd1', companyId: 'c1' });
      prisma.department.delete.mockResolvedValue({ id: 'd1' });

      const result = await service.remove('c1', 'd1');

      expect(result).toEqual({ id: 'd1' });
      expect(prisma.department.delete).toHaveBeenCalledWith({
        where: { id: 'd1' },
      });
    });

    it('should throw NotFoundException when department not found', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('c1', 'nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
