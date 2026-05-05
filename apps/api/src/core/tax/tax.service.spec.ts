import { TaxNature } from '@prisma/client';
import { TaxService } from './tax.service';

type MockPrisma = {
  taxCode: { findFirst: jest.Mock };
  auditLog: { create: jest.Mock };
};

describe('TaxService', () => {
  const prisma: MockPrisma = {
    taxCode: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  let service: TaxService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaxService(
      prisma as unknown as ConstructorParameters<typeof TaxService>[0],
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('round2', () => {
    it('should round to 2 decimal places', () => {
      expect(service.round2(1.005)).toBe(1.01);
      expect(service.round2(0)).toBe(0);
      expect(service.round2(123.456)).toBe(123.46);
    });
  });

  describe('calcTaxFromTotal', () => {
    it('should calculate subTotal and tax from inclusive total', () => {
      const result = service.calcTaxFromTotal(113, 0.13);
      expect(result.subTotal).toBe(100);
      expect(result.taxAmount).toBe(13);
      expect(result.total).toBe(113);
      expect(result.taxRate).toBe(0.13);
    });

    it('should handle zero taxRate', () => {
      const result = service.calcTaxFromTotal(100, 0);
      expect(result.subTotal).toBe(100);
      expect(result.taxAmount).toBe(0);
    });

    it('should clamp taxRate to [0,1]', () => {
      const result = service.calcTaxFromTotal(100, 2);
      expect(result.taxRate).toBe(1);
    });
  });

  describe('calcTaxBreakdown', () => {
    it('should calculate inclusive tax', () => {
      const result = service.calcTaxBreakdown(113, 0.13, true);
      expect(result.subTotal).toBe(100);
      expect(result.taxAmount).toBe(13);
      expect(result.total).toBe(113);
    });

    it('should calculate exclusive tax', () => {
      const result = service.calcTaxBreakdown(100, 0.13, false);
      expect(result.subTotal).toBe(100);
      expect(result.taxAmount).toBe(13);
      expect(result.total).toBe(113);
    });
  });

  describe('resolveTaxCode', () => {
    it('should return explicit tax code when found', async () => {
      prisma.taxCode.findFirst.mockResolvedValue({
        id: 'tc1',
        code: 'VAT_13',
        name: '增值税13%',
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: 'acc1',
        inputAccountId: null,
        accountId: 'acc1',
      });

      const result = await service.resolveTaxCode('c1', 'tc1');
      expect(result.id).toBe('tc1');
      expect(result.isFallback).toBe(false);
      expect(result.rate).toBe(0.13);
    });

    it('should throw when explicit taxCodeId not found', async () => {
      prisma.taxCode.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveTaxCode('c1', 'nonexistent'),
      ).rejects.toThrow('税码不存在或已停用');
    });

    it('should return default tax code when no explicit id', async () => {
      prisma.taxCode.findFirst.mockResolvedValue({
        id: 'tc-default',
        code: 'VAT_13',
        name: '增值税13%',
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: null,
        inputAccountId: null,
        accountId: null,
      });

      const result = await service.resolveTaxCode('c1');
      expect(result.id).toBe('tc-default');
      expect(result.isFallback).toBe(false);
    });

    it('should fallback to 13% and audit when no default configured', async () => {
      prisma.taxCode.findFirst.mockResolvedValue(null);
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.resolveTaxCode('c1', null, {
        operatorId: 'u1',
        entity: 'Order',
        entityId: 'o1',
      });

      expect(result.id).toBeNull();
      expect(result.rate).toBe(0.13);
      expect(result.isFallback).toBe(true);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'TAX_FALLBACK',
            entity: 'Order',
            entityId: 'o1',
          }),
        }),
      );
    });
  });

  describe('getTaxAccountId', () => {
    it('should return outputAccountId for OUTPUT nature', () => {
      const resolved = {
        id: 'tc1',
        code: '',
        name: '',
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: 'out-acc',
        inputAccountId: 'in-acc',
        accountId: 'legacy-acc',
        isFallback: false,
      };
      expect(service.getTaxAccountId(resolved)).toBe('out-acc');
    });

    it('should return inputAccountId for INPUT nature', () => {
      const resolved = {
        id: 'tc1',
        code: '',
        name: '',
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.INPUT,
        outputAccountId: 'out-acc',
        inputAccountId: 'in-acc',
        accountId: 'legacy-acc',
        isFallback: false,
      };
      expect(service.getTaxAccountId(resolved, TaxNature.INPUT)).toBe('in-acc');
    });

    it('should fallback to accountId when specific field is null', () => {
      const resolved = {
        id: 'tc1',
        code: '',
        name: '',
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: null,
        inputAccountId: null,
        accountId: 'legacy-acc',
        isFallback: false,
      };
      expect(service.getTaxAccountId(resolved)).toBe('legacy-acc');
    });
  });
});
