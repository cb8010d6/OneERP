import { StockQueryService } from './stock-query.service';

type MockPrisma = {
  material: {
    findMany: jest.Mock;
  };
  stockQuant: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  purchaseOrderLine: {
    findMany: jest.Mock;
  };
  warehouse: {
    findMany: jest.Mock;
  };
  stockLocation: {
    findMany: jest.Mock;
  };
  inventoryTransaction: {
    findMany: jest.Mock;
  };
  inventoryReturnDocument: {
    findMany: jest.Mock;
  };
};

describe('StockQueryService', () => {
  const prisma: MockPrisma = {
    material: {
      findMany: jest.fn(),
    },
    stockQuant: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    purchaseOrderLine: {
      findMany: jest.fn(),
    },
    warehouse: {
      findMany: jest.fn(),
    },
    stockLocation: {
      findMany: jest.fn(),
    },
    inventoryTransaction: {
      findMany: jest.fn(),
    },
    inventoryReturnDocument: {
      findMany: jest.fn(),
    },
  };

  const kyselyService = {
    withTenant: jest.fn(),
  };

  let service: StockQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    kyselyService.withTenant.mockReset();
    service = new StockQueryService(prisma as never, kyselyService as never);
  });

  describe('getCompanyStocks', () => {
    it('returns paginated stock data', async () => {
      const mockData = [
        {
          id: 'sq1',
          materialId: 'm1',
          locationId: 'loc1',
          quantity: 10,
          material: { id: 'm1', name: '钢板' },
          location: { id: 'loc1', name: '主库位', warehouse: null },
        },
      ];
      prisma.stockQuant.findMany.mockResolvedValue(mockData);
      prisma.stockQuant.count.mockResolvedValue(1);

      const result = await service.getCompanyStocks('c1', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toEqual(mockData);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(prisma.stockQuant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { location: { companyId: 'c1' } },
        }),
      );
    });
  });

  describe('getWarehouses', () => {
    it('returns warehouses for company', async () => {
      const mockWarehouses = [{ id: 'wh1', name: '主仓' }];
      prisma.warehouse.findMany.mockResolvedValue(mockWarehouses);

      const result = await service.getWarehouses('c1');

      expect(result).toEqual(mockWarehouses);
      expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
        where: { companyId: 'c1' },
      });
    });
  });

  describe('getLocations', () => {
    it('returns locations for company', async () => {
      const mockLocations = [{ id: 'loc1', name: '主库位' }];
      prisma.stockLocation.findMany.mockResolvedValue(mockLocations);

      const result = await service.getLocations('c1');

      expect(result).toEqual(mockLocations);
      expect(prisma.stockLocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
        }),
      );
    });

    it('filters by warehouseId when provided', async () => {
      prisma.stockLocation.findMany.mockResolvedValue([]);

      await service.getLocations('c1', 'wh1');

      expect(prisma.stockLocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1', warehouseId: 'wh1' },
        }),
      );
    });
  });

  describe('getMaterials', () => {
    it('returns materials for company or global', async () => {
      const mockMaterials = [{ id: 'm1', name: '钢板' }];
      prisma.material.findMany.mockResolvedValue(mockMaterials);

      const result = await service.getMaterials('c1');

      expect(result).toEqual(mockMaterials);
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { OR: [{ companyId: 'c1' }, { companyId: null }] },
      });
    });
  });

  describe('getTransactions', () => {
    it('returns recent transactions', async () => {
      const mockTransactions = [
        { id: 't1', type: 'INBOUND', materialId: 'm1', quantity: 10 },
      ];
      prisma.inventoryTransaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.getTransactions('c1');

      expect(result).toEqual(mockTransactions);
      expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
          take: 100,
        }),
      );
    });
  });

  describe('getReturnDocuments', () => {
    it('returns return documents with lines and credit notes', async () => {
      const mockDocs = [
        {
          id: 'rd1',
          returnNo: 'SR-001',
          returnType: 'SALES',
          lines: [],
          creditNote: null,
          supplierCreditNote: null,
        },
      ];
      prisma.inventoryReturnDocument.findMany.mockResolvedValue(mockDocs);

      const result = await service.getReturnDocuments('c1');

      expect(result).toEqual(mockDocs);
      expect(prisma.inventoryReturnDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
        }),
      );
    });
  });

  describe('getReplenishmentSuggestions', () => {
    it('returns suggestions for materials below min stock', async () => {
      prisma.material.findMany.mockResolvedValue([
        {
          id: 'm1',
          sku: 'MAT-1',
          name: '钢板',
          category: '板材',
          unit: 'pcs',
          minStock: 20,
          unitPrice: 12.5,
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 'm1', quantity: 5 },
      ]);
      prisma.purchaseOrderLine.findMany.mockResolvedValue([]);

      const result = await service.getReplenishmentSuggestions('c1');

      expect(result.totalSuggestions).toBe(1);
      expect(result.rows[0].shortageQty).toBe(15);
      expect(result.rows[0].severity).toBe('SHORTAGE');
    });

    it('excludes materials with sufficient stock', async () => {
      prisma.material.findMany.mockResolvedValue([
        {
          id: 'm1',
          sku: 'MAT-1',
          name: '钢板',
          category: '板材',
          unit: 'pcs',
          minStock: 10,
          unitPrice: 12.5,
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 'm1', quantity: 15 },
      ]);
      prisma.purchaseOrderLine.findMany.mockResolvedValue([]);

      const result = await service.getReplenishmentSuggestions('c1');

      expect(result.totalSuggestions).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it('nets incoming purchase quantities from shortage', async () => {
      prisma.material.findMany.mockResolvedValue([
        {
          id: 'm1',
          sku: 'MAT-1',
          name: '钢板',
          category: '板材',
          unit: 'pcs',
          minStock: 20,
          unitPrice: 12.5,
        },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { materialId: 'm1', quantity: 5 },
      ]);
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        { materialId: 'm1', quantity: 10, receivedQty: 3 },
      ]);

      const result = await service.getReplenishmentSuggestions('c1');

      expect(result.rows[0].onHandQty).toBe(5);
      expect(result.rows[0].incomingQty).toBe(7);
      expect(result.rows[0].shortageQty).toBe(8);
    });
  });

  describe('getRealtimeLedger', () => {
    it('returns ledger rows with inventory value', async () => {
      kyselyService.withTenant.mockResolvedValue({
        total: 1,
        rows: [
          {
            locationId: 'loc-1',
            locationName: '主库位',
            warehouseId: 'wh-1',
            warehouseName: '主仓',
            materialId: 'm1',
            materialSku: 'MAT-1',
            materialName: '钢板',
            materialUnit: 'pcs',
            minStock: 1,
            netQty: 5,
            batchCount: 2,
            averageCost: 12.5,
          },
        ],
      });

      const result = await service.getRealtimeLedger('c1', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          materialId: 'm1',
          netQty: 5,
          averageCost: 12.5,
          inventoryValue: 62.5,
          isLow: false,
        }),
      );
    });

    it('marks low stock when netQty <= minStock', async () => {
      kyselyService.withTenant.mockResolvedValue({
        total: 1,
        rows: [
          {
            locationId: 'loc-1',
            locationName: '主库位',
            warehouseId: null,
            warehouseName: null,
            materialId: 'm1',
            materialSku: 'MAT-1',
            materialName: '钢板',
            materialUnit: 'pcs',
            minStock: 10,
            netQty: 8,
            batchCount: 1,
            averageCost: 10,
          },
        ],
      });

      const result = await service.getRealtimeLedger('c1', {
        page: 1,
        limit: 20,
      });

      expect(result.data[0].isLow).toBe(true);
    });
  });
});
