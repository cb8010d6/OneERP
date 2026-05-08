import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ThreeWayMatchStatus } from '@prisma/client';
import { ThreeWayMatchService } from './three-way-match.service';
import { PrismaService } from '../prisma/prisma.service';

const MOCK_COMPANY = 'company-1';
const MOCK_INVOICE_ID = 'inv-1';
const MOCK_OPERATOR = 'user-1';

function makeMockPoLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pol-1',
    orderId: 'po-1',
    lineNo: 1,
    productId: null,
    materialId: 'mat-1',
    description: null,
    quantity: 100,
    receivedQuantity: 100,
    unitPrice: 10,
    taxRate: 0.13,
    taxAmount: 130,
    subTotal: 1000,
    totalAmount: 1130,
    companyId: MOCK_COMPANY,
    uom: 'pcs',
    material: { id: 'mat-1', name: 'Material A' },
    ...overrides,
  };
}

function makeMockGrLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grl-1',
    receiptId: 'gr-1',
    productId: 'prod-1',
    materialId: 'mat-1',
    locationId: 'loc-1',
    quantity: 100,
    batchNo: 'BATCH1',
    ...overrides,
  };
}

function makeMockBillLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bil-1',
    invoiceId: MOCK_INVOICE_ID,
    materialId: 'mat-1',
    quantity: 100,
    unitPrice: 10,
    lineTotal: 1130,
    subTotal: 1000,
    taxAmount: 130,
    taxRate: 0.13,
    taxCodeId: null,
    description: null,
    material: { id: 'mat-1', name: 'Material A', sku: 'MAT-A' },
    ...overrides,
  };
}

function makeMockInvoice(linesOverride?: unknown[]) {
  return {
    id: MOCK_INVOICE_ID,
    invoiceNo: 'VB-12345',
    partnerId: 'partner-1',
    receiptId: 'gr-1',
    amount: 1130,
    subTotal: 1000,
    taxAmount: 130,
    taxRate: 0.13,
    taxCodeId: null,
    taxNature: 'INPUT',
    status: 'UNPAID',
    postingStatus: 'DRAFT',
    companyId: MOCK_COMPANY,
    dueDate: new Date(),
    issuedDate: new Date(),
    notes: null,
    matchStatus: 'NOT_APPLICABLE',
    lines: linesOverride ?? [makeMockBillLine()],
    receipt: {
      id: 'gr-1',
      receiptNo: 'GR-001',
      orderId: 'po-1',
      partnerId: 'partner-1',
      status: 'CONFIRMED',
      receiptDate: new Date(),
      notes: null,
      companyId: MOCK_COMPANY,
      lines: [makeMockGrLine()],
      order: {
        id: 'po-1',
        orderNo: 'PO-001',
        partnerId: 'partner-1',
        status: 'RECEIVED',
        orderDate: new Date(),
        expectedDate: null,
        notes: null,
        subTotal: 1000,
        taxTotal: 130,
        totalAmount: 1130,
        companyId: MOCK_COMPANY,
        lines: [makeMockPoLine()],
      },
    },
  };
}

describe('ThreeWayMatchService', () => {
  let service: ThreeWayMatchService;
  let prisma: {
    purchaseInvoice: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      purchaseInvoice: { findFirst: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreeWayMatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ThreeWayMatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateMatch', () => {
    it('should return NOT_APPLICABLE when no receiptId', async () => {
      const invoice = { ...makeMockInvoice(), receiptId: null, receipt: null };
      prisma.purchaseInvoice.findFirst.mockResolvedValue(invoice);
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(result.status).toBe(ThreeWayMatchStatus.NOT_APPLICABLE);
      expect(result.overallMatched).toBe(true);
    });
    it('should return MATCHED when quantities and amounts match', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(makeMockInvoice());
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(result.status).toBe(ThreeWayMatchStatus.MATCHED);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].matched).toBe(true);
    });
    it('should detect bill qty exceeding PO qty', async () => {
      const billLine = makeMockBillLine({
        quantity: 150,
        lineTotal: 1695,
        taxAmount: 195,
        subTotal: 1500,
      });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        makeMockInvoice([billLine]),
      );
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(result.status).toBe(ThreeWayMatchStatus.MISMATCH);
      expect(
        result.lines[0].reasons.some((r: string) =>
          r.includes('超过PO采购数量'),
        ),
      ).toBe(true);
    });
    it('should detect GR qty exceeding PO qty', async () => {
      const invoice = makeMockInvoice();
      invoice.receipt.lines = [makeMockGrLine({ quantity: 150 })];
      prisma.purchaseInvoice.findFirst.mockResolvedValue(invoice);
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(
        result.lines[0].reasons.some((r: string) => r.includes('GR收货数量')),
      ).toBe(true);
    });
    it('should detect amount mismatch', async () => {
      const billLine = makeMockBillLine({
        lineTotal: 1500,
        taxAmount: 170,
        subTotal: 1330,
      });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        makeMockInvoice([billLine]),
      );
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(result.status).toBe(ThreeWayMatchStatus.MISMATCH);
    });
    it('should detect missing PO line in invoice', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(makeMockInvoice([]));
      const result = await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID);
      expect(result.status).toBe(ThreeWayMatchStatus.MISMATCH);
    });
    it('should throw NotFoundException when invoice not found', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(null);
      await expect(
        service.validateMatch(MOCK_COMPANY, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
    it('should respect custom tolerance', async () => {
      const billLine = makeMockBillLine({
        lineTotal: 1150,
        subTotal: 1018,
        taxAmount: 132,
      });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        makeMockInvoice([billLine]),
      );
      expect(
        (await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID, 0.05, 0.01))
          .lines[0].matched,
      ).toBe(true);
      expect(
        (await service.validateMatch(MOCK_COMPANY, MOCK_INVOICE_ID, 0.01, 0.01))
          .lines[0].matched,
      ).toBe(false);
    });
  });

  describe('validateAndPersist', () => {
    it('should persist MATCHED status and audit log', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(makeMockInvoice());
      prisma.purchaseInvoice.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      const result = await service.validateAndPersist(
        MOCK_COMPANY,
        MOCK_INVOICE_ID,
        MOCK_OPERATOR,
      );
      expect(result.status).toBe(ThreeWayMatchStatus.MATCHED);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
    it('should throw BadRequestException on mismatch', async () => {
      const billLine = makeMockBillLine({
        quantity: 200,
        lineTotal: 2260,
        taxAmount: 260,
        subTotal: 2000,
      });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        makeMockInvoice([billLine]),
      );
      prisma.purchaseInvoice.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
      await expect(
        service.validateAndPersist(
          MOCK_COMPANY,
          MOCK_INVOICE_ID,
          MOCK_OPERATOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
