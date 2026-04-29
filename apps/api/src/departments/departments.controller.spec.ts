import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';

describe('DepartmentsController', () => {
  let controller: DepartmentsController;

  const mockDepartmentsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [
        { provide: DepartmentsService, useValue: mockDepartmentsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DepartmentsController>(DepartmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a department', async () => {
      const expected = { id: 'd1', name: '研发部', companyId: 'c1' };
      mockDepartmentsService.create.mockResolvedValue(expected);

      const result = await controller.create('c1', { name: '研发部' });

      expect(result).toEqual(expected);
      expect(mockDepartmentsService.create).toHaveBeenCalledWith('c1', { name: '研发部' });
    });
  });

  describe('findAll', () => {
    it('should return all departments', async () => {
      const departments = [{ id: 'd1', name: '研发部' }];
      mockDepartmentsService.findAll.mockResolvedValue(departments);

      const result = await controller.findAll('c1');

      expect(result).toEqual(departments);
      expect(mockDepartmentsService.findAll).toHaveBeenCalledWith('c1');
    });
  });

  describe('update', () => {
    it('should update a department', async () => {
      const updated = { id: 'd1', name: '技术部', companyId: 'c1' };
      mockDepartmentsService.update.mockResolvedValue(updated);

      const result = await controller.update('c1', 'd1', { name: '技术部' });

      expect(result).toEqual(updated);
      expect(mockDepartmentsService.update).toHaveBeenCalledWith('c1', 'd1', { name: '技术部' });
    });
  });

  describe('remove', () => {
    it('should remove a department', async () => {
      mockDepartmentsService.remove.mockResolvedValue({ id: 'd1' });

      const result = await controller.remove('c1', 'd1');

      expect(result).toEqual({ id: 'd1' });
      expect(mockDepartmentsService.remove).toHaveBeenCalledWith('c1', 'd1');
    });
  });
});
