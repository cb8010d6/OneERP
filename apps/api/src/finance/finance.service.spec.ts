import { NotFoundException } from "@nestjs/common";
import { TaxNature } from "@prisma/client";
import { FinanceService } from "./finance.service";

type MockPrisma = {
  order: { findFirst: jest.Mock };
  taxCode: { findFirst: jest.Mock };
  invoice: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  payment: { create: jest.Mock };
  auditLog: { create: jest.Mock };
  account: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

type MockTx = {
  payment: { create: jest.Mock };
  invoice: { update: jest.Mock };
};

const mockTaxService = {
  round2: jest.fn((v: number) => Math.round((v + Number.EPSILON) * 100) / 100),
  resolveTaxCode: jest.fn(),
  calcTaxFromTotal: jest.fn(),
  getTaxAccountId: jest.fn(),
};

describe("FinanceService", () => {
  const prisma: MockPrisma = {
    order: { findFirst: jest.fn() },
    taxCode: { findFirst: jest.fn() },
    invoice: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    payment: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    account: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const tx: MockTx = {
    payment: { create: jest.fn() },
    invoice: { update: jest.fn() },
  };

  const eventEmitter = { emit: jest.fn() };

  let service: FinanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: (trx: MockTx) => unknown) =>
      cb(tx),
    );
    service = new FinanceService(
      prisma as unknown as ConstructorParameters<typeof FinanceService>[0],
      eventEmitter as unknown as ConstructorParameters<typeof FinanceService>[1],
      mockTaxService as unknown as ConstructorParameters<typeof FinanceService>[2],
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createInvoice", () => {
    it("should create an invoice when order exists", async () => {
      prisma.order.findFirst.mockResolvedValue({ id: "o1", companyId: "c1", taxCodeId: null });
      mockTaxService.resolveTaxCode.mockResolvedValue({
        id: "tc1",
        code: "VAT_13",
        name: "增值税13%",
        rate: 0.13,
        isTaxInclusive: true,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: null,
        inputAccountId: null,
        accountId: null,
        isFallback: false,
      });
      mockTaxService.calcTaxFromTotal.mockReturnValue({
        subTotal: 884.96,
        taxAmount: 115.04,
        total: 1000,
        taxRate: 0.13,
        taxNature: TaxNature.OUTPUT,
      });
      prisma.invoice.create.mockResolvedValue({
        id: "inv1",
        invoiceNo: "INV-123",
        orderId: "o1",
        amount: 1000,
        status: "UNPAID",
        companyId: "c1",
      });
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.createInvoice(
        "c1",
        { orderId: "o1", amount: 1000, dueDate: "2025-12-31" },
        "u1",
      );

      expect(result.id).toBe("inv1");
      expect(prisma.invoice.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it("should throw NotFoundException when order not found", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.createInvoice(
          "c1",
          { orderId: "x", amount: 100, dueDate: "2025-01-01" },
          "u1",
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getInvoices", () => {
    it("should return paginated invoices", async () => {
      prisma.invoice.findMany.mockResolvedValue([{ id: "inv1", amount: 1000 }]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await service.getInvoices("c1", { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe("recordPayment", () => {
    it("should record payment and update invoice to PAID", async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: "inv1",
        amount: 1000,
        status: "UNPAID",
        payments: [],
      });
      tx.payment.create.mockResolvedValue({
        id: "pay1",
        invoiceId: "inv1",
        amount: 1000,
      });
      tx.invoice.update.mockResolvedValue({});

      const result = await service.recordPayment("c1", "inv1", {
        amount: 1000,
        method: "BANK_TRANSFER",
      });

      expect(result.id).toBe("pay1");
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: "inv1" },
        data: { status: "PAID" },
      });
    });

    it("should set PARTIAL status for partial payment", async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: "inv1",
        amount: 1000,
        status: "UNPAID",
        payments: [],
      });
      tx.payment.create.mockResolvedValue({ id: "pay2", amount: 500 });
      tx.invoice.update.mockResolvedValue({});

      await service.recordPayment("c1", "inv1", {
        amount: 500,
        method: "ALIPAY",
      });

      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: "inv1" },
        data: { status: "PARTIAL" },
      });
    });

    it("should throw NotFoundException when invoice missing", async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.recordPayment("c1", "x", { amount: 100, method: "ALIPAY" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("postInvoice", () => {
    it("should post an invoice using snapshot and emit event", async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: "inv1",
        invoiceNo: "INV-123",
        postingStatus: "DRAFT",
        amount: 1000,
        subTotal: 884.96,
        taxAmount: 115.04,
        taxRate: 0.13,
        taxNature: TaxNature.OUTPUT,
        taxCodeId: "tc1",
        order: { taxCodeId: null },
        taxCode: null,
      });
      prisma.invoice.update.mockResolvedValue({
        id: "inv1",
        invoiceNo: "INV-123",
        postingStatus: "POSTED",
      });
      prisma.auditLog.create.mockResolvedValue({});
      mockTaxService.resolveTaxCode.mockResolvedValue({
        id: "tc1",
        code: "VAT_13",
        rate: 0.13,
        taxNature: TaxNature.OUTPUT,
        outputAccountId: null,
        inputAccountId: null,
        accountId: null,
        isFallback: false,
      });
      mockTaxService.getTaxAccountId.mockReturnValue(null);

      const result = await service.postInvoice("c1", "inv1", "u1");

      expect(result.postingStatus).toBe("POSTED");
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: "inv1" },
        data: expect.objectContaining({ postingStatus: "POSTED" }),
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "finance.invoice.posted",
        expect.objectContaining({
          companyId: "c1",
          invoiceId: "inv1",
          taxCodeId: "tc1",
        }),
      );
    });

    it("should skip posting when already POSTED", async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: "inv1",
        invoiceNo: "INV-123",
        postingStatus: "POSTED",
      });

      const result = await service.postInvoice("c1", "inv1", "u1");

      expect((result as { message?: string }).message).toContain("已过账");
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when invoice not found", async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.postInvoice("c1", "nonexistent", "u1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});