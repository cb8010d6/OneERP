import { PurchaseQueryService } from './purchase-query.service';

function createService() {
  const prisma = {
    supplierCreditNote: {
      findMany: jest.fn(),
    },
    supplierPayment: {
      findMany: jest.fn(),
    },
  };
  const service = new PurchaseQueryService(prisma as never);
  return { service, prisma };
}

describe('PurchaseQueryService', () => {
  describe('listSupplierCreditNotes', () => {
    it('returns supplier credit notes for company', async () => {
      const { service, prisma } = createService();
      prisma.supplierCreditNote.findMany.mockResolvedValue([
        { id: 'cn1', creditNo: 'SCN-001' },
      ]);

      const result = await service.listSupplierCreditNotes('c1');

      expect(result).toHaveLength(1);
      expect(prisma.supplierCreditNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
          take: 100,
        }),
      );
    });
  });

  describe('listSupplierPayments', () => {
    it('returns supplier payments for company', async () => {
      const { service, prisma } = createService();
      prisma.supplierPayment.findMany.mockResolvedValue([
        { id: 'pay1', paymentNo: 'SP-001' },
      ]);

      const result = await service.listSupplierPayments('c1');

      expect(result).toHaveLength(1);
      expect(prisma.supplierPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
          take: 100,
        }),
      );
    });
  });
});
