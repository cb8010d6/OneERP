import { Test, TestingModule } from '@nestjs/testing';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';

describe('ProductionController', () => {
  let controller: ProductionController;

  const mockProductionService = {
    createWorkOrder: jest.fn(),
    generateWorkOrdersFromSalesOrder: jest.fn(),
    getWorkOrders: jest.fn(),
    getMaterialAvailability: jest.fn(),
    createPurchaseOrderFromShortages: jest.fn(),
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
      .overrideGuard(PermissionsGuard)
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

      const user = { id: 'planner-1', email: 'planner@example.com' };
      const dto = {
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
        engineeringRevisionIds: ['revision-1'],
      };
      const result = await controller.createWorkOrder('c1', user, dto);

      expect(result).toEqual(expected);
      expect(mockProductionService.createWorkOrder).toHaveBeenCalledWith(
        'c1',
        dto,
        'planner-1',
      );
    });
  });

  describe('generateWorkOrdersFromSalesOrder', () => {
    it('should generate work orders from a sales order', async () => {
      const expected = { orderId: 'o1', created: [{ id: 'wo1' }] };
      mockProductionService.generateWorkOrdersFromSalesOrder.mockResolvedValue(
        expected,
      );

      const result = await controller.generateWorkOrdersFromSalesOrder(
        'c1',
        { id: 'planner-1', email: 'planner@example.com' },
        'o1',
        { skipExisting: true, engineeringRevisionIds: ['revision-1'] },
      );

      expect(result).toEqual(expected);
      expect(
        mockProductionService.generateWorkOrdersFromSalesOrder,
      ).toHaveBeenCalledWith(
        'c1',
        'o1',
        { skipExisting: true, engineeringRevisionIds: ['revision-1'] },
        'planner-1',
      );
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

  describe('getMaterialAvailability', () => {
    it('should return material availability analysis', async () => {
      const expected = {
        rows: [],
        shortageCount: 0,
        totalOpenWorkOrders: 0,
        missingBomWorkOrders: [],
      };
      mockProductionService.getMaterialAvailability.mockResolvedValue(expected);

      const result = await controller.getMaterialAvailability('c1');

      expect(result).toEqual(expected);
      expect(
        mockProductionService.getMaterialAvailability,
      ).toHaveBeenCalledWith('c1');
    });
  });

  describe('createPurchaseOrderFromShortages', () => {
    it('should create a purchase order from production shortages', async () => {
      const expected = { id: 'po1', purchaseNo: 'PO-001' };
      mockProductionService.createPurchaseOrderFromShortages.mockResolvedValue(
        expected,
      );
      const dto = {
        supplierId: 'supplier-1',
        materialIds: ['raw-1'],
        expectedDate: '2026-06-20',
      };

      const result = await controller.createPurchaseOrderFromShortages(
        'c1',
        { id: 'u1', email: 'test@example.com' },
        dto,
      );

      expect(result).toEqual(expected);
      expect(
        mockProductionService.createPurchaseOrderFromShortages,
      ).toHaveBeenCalledWith('c1', 'u1', dto);
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
        { idempotencyKey: 'report-1', goodQty: 10, defectQty: 1 },
      );

      expect(result).toEqual(expected);
      expect(mockProductionService.submitWorkReport).toHaveBeenCalledWith(
        'c1',
        'wo1',
        'u1',
        { idempotencyKey: 'report-1', goodQty: 10, defectQty: 1 },
      );
    });
  });
});
