import { BadRequestException } from '@nestjs/common';
import { SupplierStatementService } from './supplier-statement.service';

function createService() {
  const prisma = {
    partner: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    purchaseInvoice: {
      findMany: jest.fn(),
    },
    supplierPayment: {
      findMany: jest.fn(),
    },
    supplierCreditNote: {
      findMany: jest.fn(),
    },
  };
  const service = new SupplierStatementService(prisma as never);
  return { service, prisma };
}

describe('SupplierStatementService', () => {
  describe('listSupplierOptions', () => {
    it('returns active suppliers for company', async () => {
      const { service, prisma } = createService();
      const mockSuppliers = [
        { id: 's1', code: 'SUP-001', name: '供应商A', type: 'SUPPLIER' },
      ];
      prisma.partner.findMany.mockResolvedValue(mockSuppliers);

      const result = await service.listSupplierOptions('c1');

      expect(result).toEqual(mockSuppliers);
      expect(prisma.partner.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'c1',
          isActive: true,
          type: { in: ['SUPPLIER', 'BOTH'] },
        },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
        },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        take: 500,
      });
    });
  });

  describe('getSupplierStatement', () => {
    it('returns statement with posted invoices and payments', async () => {
      const { service, prisma } = createService();
      prisma.partner.findFirst.mockResolvedValue({ id: 's1' });
      prisma.purchaseInvoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'PI-001',
          amount: 1000,
          issuedDate: new Date('2026-01-15'),
          supplier: { id: 's1', code: 'SUP-001', name: '供应商A' },
          purchaseOrder: { purchaseNo: 'PO-001' },
        },
      ]);
      prisma.supplierPayment.findMany.mockResolvedValue([
        {
          id: 'pay1',
          paymentNo: 'SP-001',
          amount: 500,
          paymentDate: new Date('2026-01-20'),
          method: 'BANK_TRANSFER',
          note: null,
          supplier: { id: 's1', code: 'SUP-001', name: '供应商A' },
        },
      ]);
      prisma.supplierCreditNote.findMany.mockResolvedValue([]);

      const result = await service.getSupplierStatement('c1');

      expect(result.suppliers).toHaveLength(1);
      expect(result.suppliers[0].supplierId).toBe('s1');
      expect(result.suppliers[0].periodDebit).toBe(1000);
      expect(result.suppliers[0].periodCredit).toBe(500);
      expect(result.suppliers[0].endingBalance).toBe(500);
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(500);
    });

    it('throws when startDate is after endDate', async () => {
      const { service } = createService();

      await expect(
        service.getSupplierStatement('c1', '2026-06-01', '2026-01-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when supplier is inactive', async () => {
      const { service, prisma } = createService();
      prisma.partner.findFirst.mockResolvedValue(null);

      await expect(
        service.getSupplierStatement('c1', undefined, undefined, 's99'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listOpenPayables', () => {
    it('returns invoices with positive open amount', async () => {
      const { service, prisma } = createService();
      prisma.purchaseInvoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'PI-001',
          purchaseOrderId: 'po1',
          supplierId: 's1',
          amount: 1000,
          status: 'UNPAID',
          issuedDate: new Date('2026-01-15'),
          dueDate: new Date('2026-02-15'),
          supplier: { id: 's1', name: '供应商A' },
          purchaseOrder: { id: 'po1', purchaseNo: 'PO-001' },
          supplierCreditNotes: [],
          supplierPaymentAllocations: [],
        },
      ]);

      const result = await service.listOpenPayables('c1');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].openAmount).toBe(1000);
      expect(result.rows[0].supplierName).toBe('供应商A');
    });

    it('filters out fully paid invoices', async () => {
      const { service, prisma } = createService();
      prisma.purchaseInvoice.findMany.mockResolvedValue([
        {
          id: 'inv1',
          invoiceNo: 'PI-001',
          purchaseOrderId: 'po1',
          supplierId: 's1',
          amount: 1000,
          status: 'PAID',
          issuedDate: new Date('2026-01-15'),
          dueDate: new Date('2026-02-15'),
          supplier: { id: 's1', name: '供应商A' },
          purchaseOrder: { id: 'po1', purchaseNo: 'PO-001' },
          supplierCreditNotes: [],
          supplierPaymentAllocations: [{ amount: 1000 }],
        },
      ]);

      const result = await service.listOpenPayables('c1');

      expect(result.rows).toHaveLength(0);
    });
  });
});
