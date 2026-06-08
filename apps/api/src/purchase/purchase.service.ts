import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Decimal from 'decimal.js';
import { EntryPostingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { roundDecimal } from '../core/utils/decimal';
import {
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  CreateSupplierCreditNoteDto,
  CreateSupplierPaymentDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase.dto';
import { AccountingPeriodService } from '../finance/accounting-period.service';

type PurchaseMatchStatus =
  | 'NO_INVOICE'
  | 'PARTIAL_RECEIPT'
  | 'OVER_RECEIPT'
  | 'PRICE_VARIANCE'
  | 'MATCHED';

type PurchaseOrderForMatch = {
  items?: Array<{
    id: string;
    materialId: string;
    quantity: Prisma.Decimal | Decimal.Value;
    receivedQty: Prisma.Decimal | Decimal.Value;
    unitPrice: Prisma.Decimal | Decimal.Value;
    material?: { name?: string | null; sku?: string | null } | null;
  }>;
  invoices?: Array<{
    id: string;
    invoiceNo: string;
    amount: Prisma.Decimal | Decimal.Value;
    subTotal: Prisma.Decimal | Decimal.Value;
    taxAmount: Prisma.Decimal | Decimal.Value;
  }>;
};

export interface SupplierOption {
  id: string;
  code: string | null;
  name: string;
  type: string;
}

export interface SupplierStatementLine {
  sourceType: 'PURCHASE_INVOICE' | 'SUPPLIER_PAYMENT' | 'SUPPLIER_CREDIT_NOTE';
  sourceId: string;
  documentNo: string;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface SupplierStatementPartner {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: SupplierStatementLine[];
}

export interface SupplierStatementResult {
  startDate: string | null;
  endDate: string;
  supplierId: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  suppliers: SupplierStatementPartner[];
}

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    private readonly accountingPeriodService?: AccountingPeriodService,
  ) {}

  private async assertAccountingPeriodOpen(companyId: string, date: Date) {
    await this.accountingPeriodService?.assertOpenForDate(companyId, date);
  }

  async createPurchaseOrder(
    companyId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    const supplier = await this.prisma.partner.findFirst({
      where: {
        id: dto.supplierId,
        companyId,
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
      },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('供应商不存在或未启用');
    }

    const materialIds = dto.items.map((item) => item.materialId);
    const materialCount = await this.prisma.material.count({
      where: {
        id: { in: materialIds },
        OR: [{ companyId }, { companyId: null }],
      },
    });
    if (materialCount !== new Set(materialIds).size) {
      throw new BadRequestException('采购明细包含不存在的物料');
    }

    const lines = dto.items.map((item) => {
      const quantity = new Decimal(item.quantity);
      const unitPrice = new Decimal(item.unitPrice);
      const subTotal = this.money(quantity.times(unitPrice));
      return {
        materialId: item.materialId,
        quantity,
        unitPrice,
        subTotal,
        totalPrice: subTotal,
        taxAmount: new Decimal(0),
        note: item.note,
      };
    });

    const subTotal = this.money(
      lines.reduce((sum, line) => sum.plus(line.subTotal), new Decimal(0)),
    );

    return this.prisma.purchaseOrder.create({
      data: {
        purchaseNo: this.generateDocumentNo('PO'),
        supplierId: dto.supplierId,
        buyerId: userId,
        companyId,
        status: 'ORDERED',
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        notes: dto.notes,
        subTotal,
        taxTotal: 0,
        totalAmount: subTotal,
        items: {
          create: lines.map((line) => ({
            materialId: line.materialId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            subTotal: line.subTotal,
            taxAmount: line.taxAmount,
            totalPrice: line.totalPrice,
            note: line.note,
          })),
        },
      },
      include: this.purchaseOrderInclude(),
    });
  }

  async listPurchaseOrders(companyId: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: this.purchaseOrderInclude(),
      take: 100,
    });
    return orders.map((order) => this.withPurchaseMatch(order));
  }

  async getPurchaseOrder(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: this.purchaseOrderInclude(),
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    return this.withPurchaseMatch(order);
  }

  async getPurchaseOrderMatch(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: this.purchaseOrderInclude(),
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    return this.buildPurchaseMatchSummary(order);
  }

  async receivePurchaseOrder(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseOrderDto,
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    if (['CANCELLED', 'RECEIVED'].includes(order.status)) {
      throw new BadRequestException('当前采购单状态不允许收货');
    }

    const lineMap = new Map(order.items.map((line) => [line.id, line]));
    for (const line of dto.lines) {
      const orderLine = lineMap.get(line.purchaseOrderLineId);
      if (!orderLine) {
        throw new BadRequestException('收货明细不属于当前采购单');
      }
      const nextReceived = new Decimal(orderLine.receivedQty).plus(
        line.quantity,
      );
      if (nextReceived.gt(orderLine.quantity)) {
        throw new BadRequestException('收货数量不能超过采购数量');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseReceipt.create({
        data: {
          receiptNo: this.generateDocumentNo('GR'),
          purchaseOrderId: order.id,
          companyId,
          operatorId: userId,
          note: dto.note,
          lines: {
            create: dto.lines.map((line) => {
              const orderLine = lineMap.get(line.purchaseOrderLineId);
              if (!orderLine) {
                throw new BadRequestException('收货明细不属于当前采购单');
              }
              return {
                purchaseOrderLineId: orderLine.id,
                materialId: orderLine.materialId,
                quantity: line.quantity,
                destLocationId: line.destLocationId,
                batchNo: line.batchNo,
              };
            }),
          },
        },
        include: { lines: true },
      });

      for (const line of dto.lines) {
        const orderLine = lineMap.get(line.purchaseOrderLineId);
        if (!orderLine) continue;
        await tx.purchaseOrderLine.update({
          where: { id: orderLine.id },
          data: {
            receivedQty: new Decimal(orderLine.receivedQty).plus(line.quantity),
          },
        });
      }

      const updatedLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: order.id },
      });
      const fullyReceived = updatedLines.every((line) =>
        new Decimal(line.receivedQty).gte(line.quantity),
      );
      const partiallyReceived = updatedLines.some((line) =>
        new Decimal(line.receivedQty).gt(0),
      );
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: fullyReceived
            ? 'RECEIVED'
            : partiallyReceived
              ? 'PARTIAL_RECEIVED'
              : 'ORDERED',
        },
      });

      for (const line of created.lines) {
        const orderLine = lineMap.get(line.purchaseOrderLineId);
        await this.inventoryService.createStockMoveInTransaction(
          tx,
          companyId,
          {
            materialId: line.materialId,
            destLocationId: line.destLocationId ?? undefined,
            quantity: Number(line.quantity),
            batchNo: line.batchNo ?? undefined,
            unitCost:
              orderLine?.unitPrice != null
                ? Number(orderLine.unitPrice)
                : undefined,
            referenceNo: `PURCHASE-IN-${order.purchaseNo}-${created.receiptNo}`,
            documentType: 'PURCHASE_RECEIPT',
            documentId: created.receiptNo,
            note: dto.note ?? `采购收货：${order.purchaseNo}`,
          },
          userId,
        );
      }
    });

    return this.getPurchaseOrder(companyId, id);
  }

  async createPurchaseInvoice(
    companyId: string,
    id: string,
    dto: CreatePurchaseInvoiceDto,
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { invoices: true },
    });
    if (!order) {
      throw new NotFoundException('采购单不存在');
    }
    if (!['PARTIAL_RECEIVED', 'RECEIVED'].includes(order.status)) {
      throw new BadRequestException('采购单未收货，不能生成应付发票');
    }
    if (order.invoices.length > 0) {
      throw new BadRequestException('该采购单已生成应付发票');
    }

    return this.prisma.purchaseInvoice.create({
      data: {
        invoiceNo: dto.invoiceNo?.trim() || this.generateDocumentNo('PI'),
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        companyId,
        amount: order.totalAmount,
        subTotal: order.subTotal,
        taxAmount: order.taxTotal,
        status: 'UNPAID',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        purchaseOrder: true,
        supplier: true,
      },
    });
  }

  async postPurchaseInvoice(
    companyId: string,
    purchaseInvoiceId: string,
    operatorId?: string,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: purchaseInvoiceId, companyId },
      include: {
        purchaseOrder: {
          include: this.purchaseOrderInclude(),
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('应付发票不存在');
    }
    if (invoice.postingStatus === EntryPostingStatus.POSTED) {
      return {
        purchaseInvoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        postingStatus: invoice.postingStatus,
        message: '应付发票已过账，无需重复处理',
      };
    }
    await this.assertAccountingPeriodOpen(companyId, invoice.issuedDate);

    const match = this.buildPurchaseMatchSummary(invoice.purchaseOrder);
    if (!match.isPostable) {
      throw new BadRequestException(
        `应付发票未通过三单匹配，不能过账：${match.reasons.join('；')}`,
      );
    }

    const posted = await this.prisma.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { postingStatus: EntryPostingStatus.POSTED },
    });

    this.eventEmitter.emit('purchase.invoice.posted', {
      companyId,
      idempotencyKey: `purchase_invoice_posted:${invoice.id}`,
      purchaseInvoiceId: invoice.id,
      operatorId,
    });

    return posted;
  }

  async bulkPostPurchaseInvoices(
    companyId: string,
    purchaseInvoiceIds: string[],
    operatorId?: string,
  ) {
    const uniqueIds = [...new Set(purchaseInvoiceIds.map((id) => id.trim()))]
      .filter(Boolean)
      .slice(0, 20);
    if (uniqueIds.length === 0) {
      throw new BadRequestException('请选择需要过账的应付发票');
    }

    const invoiceRefs = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, id: { in: uniqueIds } },
      select: { id: true, invoiceNo: true },
    });
    const invoiceNoById = new Map(
      invoiceRefs.map((invoice) => [invoice.id, invoice.invoiceNo]),
    );

    const results: Array<{
      purchaseInvoiceId: string;
      status: 'POSTED' | 'SKIPPED' | 'FAILED';
      invoiceNo?: string;
      message?: string;
      error?: string;
    }> = [];

    for (const purchaseInvoiceId of uniqueIds) {
      try {
        const posted = await this.postPurchaseInvoice(
          companyId,
          purchaseInvoiceId,
          operatorId,
        );
        const postingStatus = String(posted.postingStatus);
        const skipped = 'message' in posted;
        results.push({
          purchaseInvoiceId,
          status:
            postingStatus === EntryPostingStatus.POSTED && !skipped
              ? 'POSTED'
              : 'SKIPPED',
          invoiceNo:
            'invoiceNo' in posted ? String(posted.invoiceNo) : undefined,
          message: skipped ? String(posted.message) : undefined,
        });
      } catch (error) {
        results.push({
          purchaseInvoiceId,
          status: 'FAILED',
          invoiceNo: invoiceNoById.get(purchaseInvoiceId),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      total: results.length,
      posted: results.filter((result) => result.status === 'POSTED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      skipped: results.filter((result) => result.status === 'SKIPPED').length,
      results,
    };

    if (operatorId) {
      await this.prisma.auditLog.create({
        data: {
          userId: operatorId,
          action: 'BULK_POST_PURCHASE_INVOICES',
          entity: 'PurchaseInvoice',
          entityId: null,
          companyId,
          details: summary,
        },
      });
    }

    return summary;
  }

  async listSupplierCreditNotes(companyId: string) {
    return this.prisma.supplierCreditNote.findMany({
      where: { companyId },
      include: {
        purchaseInvoice: {
          select: {
            id: true,
            invoiceNo: true,
            purchaseOrder: { select: { purchaseNo: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
        inventoryReturnDocument: {
          select: {
            id: true,
            returnNo: true,
            sourceDocumentNo: true,
          },
        },
      },
      orderBy: { creditDate: 'desc' },
      take: 100,
    });
  }

  async listSupplierPayments(companyId: string) {
    return this.prisma.supplierPayment.findMany({
      where: { companyId },
      include: {
        supplier: { select: { id: true, name: true } },
        allocations: {
          include: {
            purchaseInvoice: {
              select: {
                id: true,
                invoiceNo: true,
                purchaseOrder: { select: { purchaseNo: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { paymentDate: 'desc' },
      take: 100,
    });
  }

  async listSupplierOptions(companyId: string): Promise<SupplierOption[]> {
    return this.prisma.partner.findMany({
      where: {
        companyId,
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
  }

  async getSupplierStatement(
    companyId: string,
    startDate?: string,
    endDate?: string,
    supplierId?: string,
  ): Promise<SupplierStatementResult> {
    const parsedStartDate = this.parseStatementDate(startDate, 'startDate');
    const parsedEndDate =
      this.parseStatementDate(endDate, 'endDate') ?? new Date();

    if (
      parsedStartDate &&
      parsedStartDate.getTime() > parsedEndDate.getTime()
    ) {
      throw new BadRequestException('startDate 不能晚于 endDate');
    }

    const normalizedSupplierId = supplierId?.trim() || undefined;
    if (normalizedSupplierId) {
      const supplier = await this.prisma.partner.findFirst({
        where: {
          id: normalizedSupplierId,
          companyId,
          isActive: true,
          type: { in: ['SUPPLIER', 'BOTH'] },
        },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('供应商不存在或已停用');
      }
    }

    const [invoices, payments, creditNotes] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          issuedDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
          purchaseOrder: { select: { purchaseNo: true } },
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          paymentDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
        },
      }),
      this.prisma.supplierCreditNote.findMany({
        where: {
          companyId,
          postingStatus: EntryPostingStatus.POSTED,
          creditDate: { lte: parsedEndDate },
          ...(normalizedSupplierId ? { supplierId: normalizedSupplierId } : {}),
        },
        include: {
          supplier: true,
          purchaseInvoice: { select: { invoiceNo: true } },
        },
      }),
    ]);

    type DraftLine = Omit<SupplierStatementLine, 'runningBalance'> & {
      supplierId: string;
      supplierCode: string | null;
      supplierName: string;
      occurredAt: Date;
    };

    const draftLines: DraftLine[] = [
      ...invoices.map((invoice) => ({
        supplierId: invoice.supplier.id,
        supplierCode: invoice.supplier.code,
        supplierName: invoice.supplier.name,
        sourceType: 'PURCHASE_INVOICE' as const,
        sourceId: invoice.id,
        documentNo: invoice.invoiceNo,
        occurredAt: invoice.issuedDate,
        date: invoice.issuedDate.toISOString(),
        description: invoice.purchaseOrder.purchaseNo
          ? `应付发票 / ${invoice.purchaseOrder.purchaseNo}`
          : '应付发票',
        debit: this.money(invoice.amount ?? 0).toNumber(),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        supplierId: payment.supplier.id,
        supplierCode: payment.supplier.code,
        supplierName: payment.supplier.name,
        sourceType: 'SUPPLIER_PAYMENT' as const,
        sourceId: payment.id,
        documentNo: payment.paymentNo,
        occurredAt: payment.paymentDate,
        date: payment.paymentDate.toISOString(),
        description: payment.note
          ? `供应商付款 / ${payment.method} / ${payment.note}`
          : `供应商付款 / ${payment.method}`,
        debit: 0,
        credit: this.money(payment.amount ?? 0).toNumber(),
      })),
      ...creditNotes.map((creditNote) => ({
        supplierId: creditNote.supplier.id,
        supplierCode: creditNote.supplier.code,
        supplierName: creditNote.supplier.name,
        sourceType: 'SUPPLIER_CREDIT_NOTE' as const,
        sourceId: creditNote.id,
        documentNo: creditNote.creditNo,
        occurredAt: creditNote.creditDate,
        date: creditNote.creditDate.toISOString(),
        description: creditNote.purchaseInvoice.invoiceNo
          ? `供应商扣款 / ${creditNote.purchaseInvoice.invoiceNo}`
          : '供应商扣款',
        debit: 0,
        credit: this.money(creditNote.amount ?? 0).toNumber(),
      })),
    ].sort(
      (a, b) =>
        a.supplierName.localeCompare(b.supplierName) ||
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.documentNo.localeCompare(b.documentNo),
    );

    const suppliersById = new Map<string, SupplierStatementPartner>();
    for (const line of draftLines) {
      const supplier = suppliersById.get(line.supplierId) ?? {
        supplierId: line.supplierId,
        supplierCode: line.supplierCode,
        supplierName: line.supplierName,
        openingBalance: 0,
        periodDebit: 0,
        periodCredit: 0,
        endingBalance: 0,
        lines: [],
      };
      suppliersById.set(line.supplierId, supplier);

      const net = this.money(line.debit).minus(line.credit).toNumber();
      if (
        parsedStartDate &&
        line.occurredAt.getTime() < parsedStartDate.getTime()
      ) {
        supplier.openingBalance = this.money(
          this.money(supplier.openingBalance).plus(net),
        ).toNumber();
        supplier.endingBalance = supplier.openingBalance;
        continue;
      }

      supplier.periodDebit = this.money(
        this.money(supplier.periodDebit).plus(line.debit),
      ).toNumber();
      supplier.periodCredit = this.money(
        this.money(supplier.periodCredit).plus(line.credit),
      ).toNumber();
      supplier.endingBalance = this.money(
        this.money(supplier.endingBalance).plus(net),
      ).toNumber();
      supplier.lines.push({
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        documentNo: line.documentNo,
        date: line.date,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        runningBalance: supplier.endingBalance,
      });
    }

    const suppliers = [...suppliersById.values()]
      .map((supplier) => ({
        ...supplier,
        endingBalance: this.money(
          this.money(supplier.openingBalance)
            .plus(supplier.periodDebit)
            .minus(supplier.periodCredit),
        ).toNumber(),
      }))
      .filter(
        (supplier) =>
          Math.abs(supplier.openingBalance) >= 0.01 ||
          Math.abs(supplier.periodDebit) >= 0.01 ||
          Math.abs(supplier.periodCredit) >= 0.01 ||
          Math.abs(supplier.endingBalance) >= 0.01,
      )
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

    return {
      startDate: parsedStartDate?.toISOString() ?? null,
      endDate: parsedEndDate.toISOString(),
      supplierId: normalizedSupplierId ?? null,
      totalOpeningBalance: this.money(
        suppliers.reduce((sum, supplier) => sum + supplier.openingBalance, 0),
      ).toNumber(),
      totalDebit: this.money(
        suppliers.reduce((sum, supplier) => sum + supplier.periodDebit, 0),
      ).toNumber(),
      totalCredit: this.money(
        suppliers.reduce((sum, supplier) => sum + supplier.periodCredit, 0),
      ).toNumber(),
      totalEndingBalance: this.money(
        suppliers.reduce((sum, supplier) => sum + supplier.endingBalance, 0),
      ).toNumber(),
      suppliers,
    };
  }

  async listOpenPayables(companyId: string) {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        postingStatus: EntryPostingStatus.POSTED,
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, purchaseNo: true } },
        supplierCreditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
        supplierPaymentAllocations: {
          where: {
            supplierPayment: { postingStatus: EntryPostingStatus.POSTED },
          },
          select: { amount: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { issuedDate: 'asc' }],
      take: 500,
    });

    const rows = invoices
      .map((invoice) => {
        const amount = this.money(invoice.amount);
        const creditedAmount = this.postedSupplierCreditAmount(
          invoice.supplierCreditNotes,
        );
        const paidAmount = this.postedSupplierPaymentAmount(
          invoice.supplierPaymentAllocations,
        );
        const openAmount = this.purchaseInvoiceOpenAmount(invoice);
        const dueDate = invoice.dueDate ?? null;
        const daysOverdue = dueDate
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
              ),
            )
          : 0;

        return {
          purchaseInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          purchaseOrderId: invoice.purchaseOrderId,
          purchaseNo: invoice.purchaseOrder.purchaseNo,
          supplierId: invoice.supplierId,
          supplierName: invoice.supplier.name,
          issuedDate: invoice.issuedDate.toISOString(),
          dueDate: dueDate?.toISOString() ?? null,
          daysOverdue,
          amount: amount.toNumber(),
          creditedAmount: creditedAmount.toNumber(),
          paidAmount: paidAmount.toNumber(),
          openAmount: openAmount.toNumber(),
          status: invoice.status,
        };
      })
      .filter((row) => row.openAmount > 0);

    return { rows };
  }

  async createSupplierPayment(
    companyId: string,
    dto: CreateSupplierPaymentDto,
  ) {
    const supplier = await this.prisma.partner.findFirst({
      where: {
        id: dto.supplierId,
        companyId,
        isActive: true,
        type: { in: ['SUPPLIER', 'BOTH'] },
      },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('供应商不存在或未启用');
    }

    const paymentAmount = this.money(dto.amount);
    if (paymentAmount.lte(0)) {
      throw new BadRequestException('付款金额必须大于0');
    }

    const allocationMap = new Map<string, Decimal>();
    for (const allocation of dto.allocations) {
      const amount = this.money(allocation.amount);
      if (amount.lte(0)) {
        throw new BadRequestException('付款核销金额必须大于0');
      }
      if (allocationMap.has(allocation.purchaseInvoiceId)) {
        throw new BadRequestException('同一应付发票不能重复分配');
      }
      allocationMap.set(allocation.purchaseInvoiceId, amount);
    }

    const allocatedTotal = this.money(
      [...allocationMap.values()].reduce(
        (sum, amount) => sum.plus(amount),
        new Decimal(0),
      ),
    );
    if (allocatedTotal.lte(0)) {
      throw new BadRequestException('付款核销金额必须大于0');
    }
    if (allocatedTotal.gt(paymentAmount.plus(0.01))) {
      throw new BadRequestException('核销金额合计不能超过付款金额');
    }

    const invoiceIds = [...allocationMap.keys()];
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { id: { in: invoiceIds }, companyId },
      include: {
        supplierCreditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
        supplierPaymentAllocations: {
          where: {
            supplierPayment: { postingStatus: EntryPostingStatus.POSTED },
          },
          select: { amount: true },
        },
      },
    });
    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('存在应付发票不存在或无权访问');
    }

    for (const invoice of invoices) {
      if (invoice.supplierId !== dto.supplierId) {
        throw new BadRequestException('只能核销同一供应商的应付发票');
      }
      const allocated = allocationMap.get(invoice.id) ?? new Decimal(0);
      const openAmount = this.purchaseInvoiceOpenAmount(invoice);
      if (allocated.gt(openAmount.plus(0.01))) {
        throw new BadRequestException(
          `应付发票 ${invoice.invoiceNo} 付款金额超过未结应付`,
        );
      }
    }

    return this.prisma.supplierPayment.create({
      data: {
        paymentNo: this.generateDocumentNo('SP'),
        supplierId: dto.supplierId,
        amount: paymentAmount,
        method: dto.method,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        note: dto.note ?? null,
        postingStatus: EntryPostingStatus.DRAFT,
        companyId,
        allocations: {
          create: [...allocationMap.entries()].map(
            ([purchaseInvoiceId, amount]) => ({
              purchaseInvoiceId,
              amount,
              companyId,
            }),
          ),
        },
      },
      include: {
        supplier: true,
        allocations: { include: { purchaseInvoice: true } },
      },
    });
  }

  async createSupplierCreditNote(
    companyId: string,
    purchaseInvoiceId: string,
    dto: CreateSupplierCreditNoteDto,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: purchaseInvoiceId, companyId },
      include: {
        purchaseOrder: { select: { id: true, purchaseNo: true } },
        supplierCreditNotes: {
          where: { postingStatus: EntryPostingStatus.POSTED },
          select: { amount: true, postingStatus: true },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('应付发票不存在');
    }

    const amount = this.money(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('供应商贷项金额必须大于0');
    }

    const postedCreditAmount = this.postedSupplierCreditAmount(
      invoice.supplierCreditNotes,
    );
    const invoiceAmount = this.money(invoice.amount);
    if (amount.gt(invoiceAmount.minus(postedCreditAmount).plus(0.01))) {
      throw new BadRequestException('供应商贷项金额超过发票剩余应付');
    }

    let inventoryReturnDocumentId: string | null = null;
    if (dto.inventoryReturnDocumentId) {
      const returnDocument =
        await this.prisma.inventoryReturnDocument.findFirst({
          where: { id: dto.inventoryReturnDocumentId, companyId },
          include: {
            supplierCreditNote: { select: { id: true, creditNo: true } },
          },
        });
      if (!returnDocument) {
        throw new NotFoundException('采购退货单不存在或无权访问');
      }
      if (returnDocument.returnType !== 'PURCHASE') {
        throw new BadRequestException('只有采购退货单可以关联供应商贷项');
      }
      if (returnDocument.status !== 'POSTED') {
        throw new BadRequestException('采购退货单尚未过账，不能创建供应商贷项');
      }
      if (
        returnDocument.sourceDocumentNo !== invoice.purchaseOrder.purchaseNo
      ) {
        throw new BadRequestException('采购退货单与应付发票采购单不匹配');
      }
      if (returnDocument.supplierCreditNote) {
        throw new BadRequestException(
          `采购退货单已关联供应商贷项 ${returnDocument.supplierCreditNote.creditNo}`,
        );
      }
      inventoryReturnDocumentId = returnDocument.id;
    }

    return this.prisma.supplierCreditNote.create({
      data: {
        creditNo: this.generateDocumentNo('SCN'),
        purchaseInvoiceId: invoice.id,
        supplierId: invoice.supplierId,
        amount,
        inventoryReturnDocumentId,
        reason: dto.reason ?? null,
        status: 'DRAFT',
        postingStatus: EntryPostingStatus.DRAFT,
        creditDate: dto.creditDate ? new Date(dto.creditDate) : new Date(),
        companyId,
      },
      include: {
        purchaseInvoice: true,
        supplier: true,
        inventoryReturnDocument: true,
      },
    });
  }

  async postSupplierCreditNote(
    companyId: string,
    supplierCreditNoteId: string,
    operatorId?: string,
  ) {
    const creditNote = await this.prisma.supplierCreditNote.findFirst({
      where: { id: supplierCreditNoteId, companyId },
      include: {
        purchaseInvoice: {
          include: {
            supplierCreditNotes: {
              where: {
                postingStatus: EntryPostingStatus.POSTED,
                id: { not: supplierCreditNoteId },
              },
              select: { amount: true, postingStatus: true },
            },
          },
        },
      },
    });
    if (!creditNote) {
      throw new NotFoundException('供应商贷项不存在');
    }
    if (creditNote.postingStatus === EntryPostingStatus.POSTED) {
      return {
        supplierCreditNoteId: creditNote.id,
        creditNo: creditNote.creditNo,
        postingStatus: creditNote.postingStatus,
        message: '供应商贷项已过账，无需重复处理',
      };
    }
    await this.assertAccountingPeriodOpen(companyId, creditNote.creditDate);

    const amount = this.money(creditNote.amount);
    const invoiceAmount = this.money(creditNote.purchaseInvoice.amount);
    const postedCreditAmount = this.postedSupplierCreditAmount(
      creditNote.purchaseInvoice.supplierCreditNotes,
    );
    if (amount.gt(invoiceAmount.minus(postedCreditAmount).plus(0.01))) {
      throw new BadRequestException('供应商贷项金额超过发票剩余应付');
    }

    const nextCreditedAmount = postedCreditAmount.plus(amount);
    const status = this.supplierSettlementStatus(
      invoiceAmount,
      nextCreditedAmount,
    );

    const posted = await this.prisma.$transaction(async (tx) => {
      const posted = await tx.supplierCreditNote.update({
        where: { id: creditNote.id },
        data: {
          status: 'POSTED',
          postingStatus: EntryPostingStatus.POSTED,
          postedAt: new Date(),
        },
      });
      await tx.purchaseInvoice.update({
        where: { id: creditNote.purchaseInvoiceId },
        data: { status },
      });
      return posted;
    });

    this.eventEmitter.emit('purchase.supplier_credit_note.posted', {
      companyId,
      idempotencyKey: `supplier_credit_note_posted:${creditNote.id}`,
      supplierCreditNoteId: creditNote.id,
      operatorId,
    });

    return posted;
  }

  async postSupplierPayment(
    companyId: string,
    supplierPaymentId: string,
    operatorId?: string,
  ) {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id: supplierPaymentId, companyId },
      include: {
        allocations: {
          include: {
            purchaseInvoice: {
              include: {
                supplierCreditNotes: {
                  where: { postingStatus: EntryPostingStatus.POSTED },
                  select: { amount: true, postingStatus: true },
                },
                supplierPaymentAllocations: {
                  where: {
                    supplierPayment: {
                      postingStatus: EntryPostingStatus.POSTED,
                      id: { not: supplierPaymentId },
                    },
                  },
                  select: { amount: true },
                },
              },
            },
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException('供应商付款不存在');
    }
    if (payment.postingStatus === EntryPostingStatus.POSTED) {
      return {
        supplierPaymentId: payment.id,
        paymentNo: payment.paymentNo,
        postingStatus: payment.postingStatus,
        message: '供应商付款已过账，无需重复处理',
      };
    }
    await this.assertAccountingPeriodOpen(companyId, payment.paymentDate);
    if (!payment.allocations.length) {
      throw new BadRequestException('供应商付款缺少核销明细');
    }

    const paymentAmount = this.money(payment.amount);
    const allocatedTotal = this.money(
      payment.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Decimal(0),
      ),
    );
    if (allocatedTotal.gt(paymentAmount.plus(0.01))) {
      throw new BadRequestException('核销金额合计不能超过付款金额');
    }

    for (const allocation of payment.allocations) {
      const openAmount = this.purchaseInvoiceOpenAmount(
        allocation.purchaseInvoice,
      );
      const amount = this.money(allocation.amount);
      if (amount.gt(openAmount.plus(0.01))) {
        throw new BadRequestException(
          `应付发票 ${allocation.purchaseInvoice.invoiceNo} 付款金额超过未结应付`,
        );
      }
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const posted = await tx.supplierPayment.update({
        where: { id: payment.id },
        data: {
          postingStatus: EntryPostingStatus.POSTED,
          postedAt: new Date(),
        },
      });

      for (const allocation of payment.allocations) {
        const invoice = allocation.purchaseInvoice;
        const credited = this.postedSupplierCreditAmount(
          invoice.supplierCreditNotes,
        );
        const paidBefore = this.postedSupplierPaymentAmount(
          invoice.supplierPaymentAllocations,
        );
        const status = this.supplierSettlementStatus(
          this.money(invoice.amount),
          credited.plus(paidBefore).plus(allocation.amount),
        );
        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { status },
        });
      }

      return posted;
    });

    this.eventEmitter.emit('purchase.supplier_payment.posted', {
      companyId,
      idempotencyKey: `supplier_payment_posted:${payment.id}`,
      supplierPaymentId: payment.id,
      operatorId,
    });

    return posted;
  }

  private purchaseOrderInclude() {
    return {
      supplier: true,
      items: { include: { material: true } },
      receipts: {
        include: { lines: true },
        orderBy: { createdAt: 'desc' as const },
      },
      invoices: {
        include: {
          supplierCreditNotes: true,
          supplierPaymentAllocations: {
            include: { supplierPayment: true },
          },
        },
      },
    };
  }

  private withPurchaseMatch<T extends PurchaseOrderForMatch>(order: T) {
    return {
      ...order,
      purchaseMatch: this.buildPurchaseMatchSummary(order),
    };
  }

  private buildPurchaseMatchSummary(order: PurchaseOrderForMatch) {
    const tolerance = new Decimal(0.01);
    const lines = (order.items ?? []).map((line) => {
      const orderedQty = this.money(line.quantity);
      const receivedQty = this.money(line.receivedQty);
      const unitPrice = this.money(line.unitPrice);
      const orderedAmount = this.money(orderedQty.times(unitPrice));
      const receivedAmount = this.money(receivedQty.times(unitPrice));
      const quantityVariance = this.money(receivedQty.minus(orderedQty));
      const amountVariance = this.money(receivedAmount.minus(orderedAmount));
      const status: PurchaseMatchStatus = quantityVariance.gt(tolerance)
        ? 'OVER_RECEIPT'
        : quantityVariance.lt(tolerance.negated())
          ? 'PARTIAL_RECEIPT'
          : 'MATCHED';

      return {
        purchaseOrderLineId: line.id,
        materialId: line.materialId,
        materialName: line.material?.name ?? null,
        materialSku: line.material?.sku ?? null,
        orderedQty: orderedQty.toNumber(),
        receivedQty: receivedQty.toNumber(),
        quantityVariance: quantityVariance.toNumber(),
        orderedAmount: orderedAmount.toNumber(),
        receivedAmount: receivedAmount.toNumber(),
        amountVariance: amountVariance.toNumber(),
        status,
      };
    });

    const orderedQty = this.money(
      lines.reduce((sum, line) => sum.plus(line.orderedQty), new Decimal(0)),
    );
    const receivedQty = this.money(
      lines.reduce((sum, line) => sum.plus(line.receivedQty), new Decimal(0)),
    );
    const orderedAmount = this.money(
      lines.reduce((sum, line) => sum.plus(line.orderedAmount), new Decimal(0)),
    );
    const receivedAmount = this.money(
      lines.reduce(
        (sum, line) => sum.plus(line.receivedAmount),
        new Decimal(0),
      ),
    );
    const invoicedAmount = this.money(
      (order.invoices ?? []).reduce((sum, invoice) => {
        const subTotal = this.money(invoice.subTotal ?? 0);
        const fallbackAmount = this.money(invoice.amount ?? 0).minus(
          invoice.taxAmount ?? 0,
        );
        return sum.plus(subTotal.gt(0) ? subTotal : fallbackAmount);
      }, new Decimal(0)),
    );
    const quantityVariance = this.money(receivedQty.minus(orderedQty));
    const amountVariance = this.money(invoicedAmount.minus(receivedAmount));
    const hasInvoice = (order.invoices ?? []).length > 0;
    const reasons: string[] = [];

    if (!hasInvoice) {
      reasons.push('尚未生成应付发票');
    }
    if (lines.some((line) => line.status === 'OVER_RECEIPT')) {
      reasons.push('存在超收明细');
    }
    if (lines.some((line) => line.status === 'PARTIAL_RECEIPT')) {
      reasons.push('存在未收足明细');
    }
    if (hasInvoice && amountVariance.abs().gt(tolerance)) {
      reasons.push(`采购价差 ${amountVariance.toFixed(2)} 将自动入账`);
    }

    const hasBlockingVariance =
      !hasInvoice ||
      lines.some((line) => line.status === 'OVER_RECEIPT') ||
      lines.some((line) => line.status === 'PARTIAL_RECEIPT');
    const status: PurchaseMatchStatus = !hasInvoice
      ? 'NO_INVOICE'
      : lines.some((line) => line.status === 'OVER_RECEIPT')
        ? 'OVER_RECEIPT'
        : lines.some((line) => line.status === 'PARTIAL_RECEIPT')
          ? 'PARTIAL_RECEIPT'
          : amountVariance.abs().gt(tolerance)
            ? 'PRICE_VARIANCE'
            : 'MATCHED';

    return {
      status,
      isPostable: !hasBlockingVariance,
      orderedQty: orderedQty.toNumber(),
      receivedQty: receivedQty.toNumber(),
      quantityVariance: quantityVariance.toNumber(),
      orderedAmount: orderedAmount.toNumber(),
      receivedAmount: receivedAmount.toNumber(),
      invoicedAmount: invoicedAmount.toNumber(),
      amountVariance: amountVariance.toNumber(),
      tolerance: tolerance.toNumber(),
      reasons,
      lines,
    };
  }

  private postedSupplierCreditAmount(
    creditNotes?: Array<{
      amount: Prisma.Decimal | Decimal.Value;
      postingStatus?: EntryPostingStatus;
    }>,
  ) {
    return (creditNotes ?? [])
      .filter((creditNote) => creditNote.postingStatus === 'POSTED')
      .reduce((sum, creditNote) => sum.plus(creditNote.amount), new Decimal(0));
  }

  private postedSupplierPaymentAmount(
    allocations?: Array<{
      amount: Prisma.Decimal | Decimal.Value;
      supplierPayment?: { postingStatus?: EntryPostingStatus };
    }>,
  ) {
    return (allocations ?? [])
      .filter(
        (allocation) =>
          !allocation.supplierPayment ||
          allocation.supplierPayment.postingStatus === 'POSTED',
      )
      .reduce((sum, allocation) => sum.plus(allocation.amount), new Decimal(0));
  }

  private purchaseInvoiceOpenAmount(invoice: {
    amount: Prisma.Decimal | Decimal.Value;
    supplierCreditNotes?: Array<{
      amount: Prisma.Decimal | Decimal.Value;
      postingStatus?: EntryPostingStatus;
    }>;
    supplierPaymentAllocations?: Array<{
      amount: Prisma.Decimal | Decimal.Value;
      supplierPayment?: { postingStatus?: EntryPostingStatus };
    }>;
  }) {
    const invoiceAmount = this.money(invoice.amount);
    const credited = this.postedSupplierCreditAmount(
      invoice.supplierCreditNotes,
    );
    const paid = this.postedSupplierPaymentAmount(
      invoice.supplierPaymentAllocations,
    );
    return Decimal.max(0, invoiceAmount.minus(credited).minus(paid));
  }

  private supplierSettlementStatus(invoiceAmount: Decimal, settled: Decimal) {
    if (settled.gte(invoiceAmount.minus(0.01))) return 'PAID';
    if (settled.gt(0)) return 'PARTIAL';
    return 'UNPAID';
  }

  private money(value: Decimal.Value) {
    return new Decimal(roundDecimal(value));
  }

  private parseStatementDate(
    value: string | undefined,
    fieldName: 'startDate' | 'endDate',
  ) {
    if (!value) return undefined;
    const normalized =
      fieldName === 'endDate' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T23:59:59.999Z`
        : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} 日期格式无效`);
    }
    return date;
  }

  private generateDocumentNo(prefix: string) {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    return `${prefix}-${date}-${String(now.getTime()).slice(-6)}`;
  }
}
