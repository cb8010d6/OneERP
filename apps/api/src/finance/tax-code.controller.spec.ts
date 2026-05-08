import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TaxCodeController } from './tax-code.controller';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';

describe('TaxCodeController', () => {
  let controller: TaxCodeController;

  const mockPrisma = {
    taxCode: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxCodeController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TaxCodeController>(TaxCodeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a tax code', async () => {
      mockPrisma.taxCode.findFirst.mockResolvedValue(null);
      mockPrisma.taxCode.create.mockResolvedValue({
        id: 'tc1',
        code: 'VAT_13',
        name: '增值税13%',
      });

      const result = await controller.create('c1', {
        code: 'VAT_13',
        name: '增值税13%',
        rate: 0.13,
      });

      expect(result.id).toBe('tc1');
      expect(mockPrisma.taxCode.create).toHaveBeenCalled();
    });

    it('should throw when code already exists', async () => {
      mockPrisma.taxCode.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        controller.create('c1', {
          code: 'VAT_13',
          name: '增值税13%',
          rate: 0.13,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('should return tax codes', async () => {
      mockPrisma.taxCode.findMany.mockResolvedValue([
        { id: 'tc1', code: 'VAT_13' },
      ]);

      const result = await controller.list('c1');
      expect(result).toHaveLength(1);
    });
  });
});
