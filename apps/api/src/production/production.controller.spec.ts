import { Test, TestingModule } from '@nestjs/testing';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';

describe('ProductionController', () => {
  let controller: ProductionController;

  const mockProductionService = {
    createWorkOrder: jest.fn(),
    getWorkOrders: jest.fn(),
    submitWorkReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductionController],
      providers: [
        { provide: ProductionService, useValue: mockProductionService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductionController>(ProductionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createWorkOrder', () => {
    it('should create a work order', async () => {
      const expected = { id: 'wo1', workOrderNo: 'WO-123' };
      mockProductionService.createWorkOrder.mockResolvedValue(expected);

      const result = await controller.createWorkOrder('c1', {
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
      });

      expect(result).toEqual(expected);
      expect(mockProductionService.createWorkOrder).toHaveBeenCalledWith('c1', {
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
      });
    });
  });

  describe('getWorkOrders', () => {
    it('should return paginated work orders', async () => {
      const expected = {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
      mockProductionService.getWorkOrders.mockResolvedValue(expected);

      const result = await controller.getWorkOrders('c1', {
        page: 1,
        limit: 20,
      });

      expect(result).toEqual(expected);
      expect(mockProductionService.getWorkOrders).toHaveBeenCalledWith('c1', {
        page: 1,
        limit: 20,
      });
    });
  });

  describe('submitWorkReport', () => {
    it('should submit a work report', async () => {
      const expected = { id: 'wr1', goodQty: 10, defectQty: 1 };
      mockProductionService.submitWorkReport.mockResolvedValue(expected);

      const result = await controller.submitWorkReport(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        'wo1',
        { goodQty: 10, defectQty: 1 },
      );

      expect(result).toEqual(expected);
      expect(mockProductionService.submitWorkReport).toHaveBeenCalledWith(
        'c1',
        'wo1',
        'u1',
        { goodQty: 10, defectQty: 1 },
      );
    });
  });
});
