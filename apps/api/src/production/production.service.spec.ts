import { NotFoundException } from '@nestjs/common';
import { ProductionService } from './production.service';

type MockPrisma = {
  order: {
    findFirst: jest.Mock;
  };
  workOrder: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  workReport: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

type MockTx = {
  workReport: {
    create: jest.Mock;
  };
  workOrder: {
    update: jest.Mock;
  };
};

describe('ProductionService', () => {
  const prisma: MockPrisma = {
    order: {
      findFirst: jest.fn(),
    },
    workOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    workReport: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    workReport: {
      create: jest.fn(),
    },
    workOrder: {
      update: jest.fn(),
    },
  };

  let service: ProductionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (trx: MockTx) => unknown) => callback(tx),
    );
    service = new ProductionService(
      prisma as unknown as ConstructorParameters<typeof ProductionService>[0],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWorkOrder', () => {
    it('should create a work order when order exists', async () => {
      const order = { id: 'o1', companyId: 'c1' };
      const workOrder = {
        id: 'wo1',
        workOrderNo: 'WO-123',
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
        status: 'PENDING',
        companyId: 'c1',
      };
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.workOrder.create.mockResolvedValue(workOrder);

      const result: {
        id: string;
        workOrderNo: string;
        orderId: string;
        productId: string;
        plannedQty: number;
        status: string;
        companyId: string;
      } = (await service.createWorkOrder('c1', {
        orderId: 'o1',
        productId: 'p1',
        plannedQty: 100,
      })) as unknown as {
        id: string;
        workOrderNo: string;
        orderId: string;
        productId: string;
        plannedQty: number;
        status: string;
        companyId: string;
      };

      expect(result).toEqual(workOrder);
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'o1', companyId: 'c1' },
      });
      expect(prisma.workOrder.create).toHaveBeenCalledWith({
        data: {
          orderId: 'o1',
          productId: 'p1',
          plannedQty: 100,
          status: 'PENDING',
          companyId: 'c1',
        },
      });
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createWorkOrder('c1', {
          orderId: 'nonexistent',
          productId: 'p1',
          plannedQty: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getWorkOrders', () => {
    it('should return paginated work orders', async () => {
      const workOrders = [{ id: 'wo1', status: 'PENDING' }];
      prisma.workOrder.findMany.mockResolvedValue(workOrders);
      prisma.workOrder.count.mockResolvedValue(1);

      const result = await service.getWorkOrders('c1', { page: 1, limit: 20 });

      expect(result.data).toEqual(workOrders);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('submitWorkReport', () => {
    it('should submit a work report and update work order', async () => {
      const workOrder = {
        id: 'wo1',
        companyId: 'c1',
        actualQty: 10,
        plannedQty: 100,
        status: 'PENDING',
      };
      prisma.workOrder.findFirst.mockResolvedValue(workOrder);
      tx.workReport.create.mockResolvedValue({
        id: 'wr1',
        workOrderId: 'wo1',
        goodQty: 20,
        defectQty: 2,
      });
      tx.workOrder.update.mockResolvedValue({});

      const result = (await service.submitWorkReport('c1', 'wo1', 'u1', {
        goodQty: 20,
        defectQty: 2,
      })) as { id: string };

      expect(result.id).toBe('wr1');
      expect(tx.workReport.create).toHaveBeenCalled();
      expect(tx.workOrder.update).toHaveBeenCalledWith({
        where: { id: 'wo1' },
        data: { actualQty: 30, status: 'IN_PROGRESS' },
      });
    });

    it('should mark work order as COMPLETED when actualQty meets plannedQty', async () => {
      const workOrder = {
        id: 'wo1',
        companyId: 'c1',
        actualQty: 80,
        plannedQty: 100,
        status: 'IN_PROGRESS',
      };
      prisma.workOrder.findFirst.mockResolvedValue(workOrder);
      tx.workReport.create.mockResolvedValue({
        id: 'wr2',
        workOrderId: 'wo1',
        goodQty: 25,
        defectQty: 0,
      });
      tx.workOrder.update.mockResolvedValue({});

      await service.submitWorkReport('c1', 'wo1', 'u1', {
        goodQty: 25,
        defectQty: 0,
      });

      expect(tx.workOrder.update).toHaveBeenCalledWith({
        where: { id: 'wo1' },
        data: { actualQty: 105, status: 'COMPLETED' },
      });
    });

    it('should throw NotFoundException when work order not found', async () => {
      prisma.workOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.submitWorkReport('c1', 'nonexistent', 'u1', {
          goodQty: 10,
          defectQty: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
