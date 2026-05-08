import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntryPostingStatus, TaxNature } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaxService } from '../core/tax/tax.service';
import { PaginationDto } from '../core/dto/pagination.dto';
import { ThreeWayMatchService } from './three-way-match.service';
import {
  CreateVendorBillDto,
  RecordVendorBillPaymentDto,
} from './dto/vendor-bill.dto';

type ResolvedTaxCode = Awaited<ReturnType<TaxService['resolveTaxCode']>>;

type CalculatedVendorBillLine = {
  materialId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  subTotal: number;
  taxAmount: number;
  taxRate: number;
  taxCodeId: string | null;
  accountId?: string;
  description?: string;
};

@Injectable()
export class VendorBillService {
  private readonly logger = new Logger(VendorBillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly taxService: TaxService,
    private readonly threeWayMatchService: ThreeWayMatchService,
  ) {}

  async create(
    companyId: string,
    dto: CreateVendorBillDto,
    operatorId: string,
  ) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: dto.partnerId, companyId, isActive: true },
      select: { id: true, name: true },
    });
    if (!partner) throw new NotFoundException('供应商不存在');

    if (dto.receiptId) {
      const receipt = await this.prisma.goodsReceipt.findFirst({
        where: { id: dto.receiptId, companyId },
        select: { id: true, partnerId: true },
      });
      if (!receipt) throw new NotFoundException('入库单不存在');
      if (receipt.partnerId !== dto.partnerId) {
        throw new BadRequestException('入库单供应商与发票供应商不匹配');
      }
    }

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('采购发票至少需要一行明细');
    }

    const resolvedTaxCode = await this.taxService.resolveTaxCode(
      companyId,
      dto.taxCodeId,
      { operatorId, entity: 'PurchaseInvoice', entityId: 'new' },
    );

    const lineResults = await this.calculateLines(
      companyId,
      dto.lines,
      resolvedTaxCode,
    );
    const totals = this.calculateTotals(lineResults);
    const invoiceNo = dto.invoiceNo ?? 'VB-' + Date.now();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseInvoice.create({
        data: {
          invoiceNo,
          partnerId: dto.partnerId,
          receiptId: dto.receiptId ?? null,
          amount: totals.totalAmount,
          subTotal: totals.totalSubTotal,
          taxAmount: totals.totalTaxAmount,
          taxRate: resolvedTaxCode.rate,
          taxCodeId: resolvedTaxCode.id ?? null,
          taxNature: TaxNature.INPUT,
          status: 'UNPAID',
          postingStatus: EntryPostingStatus.DRAFT,
          companyId,
          dueDate: new Date(dto.dueDate),
          notes: dto.notes ?? null,
          lines: {
            create: lineResults.map((line) => ({
              materialId: line.materialId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              subTotal: line.subTotal,
              taxAmount: line.taxAmount,
              taxRate: line.taxRate,
              taxCodeId: line.taxCodeId,
              accountId: line.accountId ?? null,
              description: line.description ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'CREATE_VENDOR_BILL',
          entity: 'PurchaseInvoice',
          entityId: created.id,
          details: {
            invoiceNo: created.invoiceNo,
            partnerId: dto.partnerId,
            receiptId: dto.receiptId ?? null,
            amount: totals.totalAmount,
            lineCount: lineResults.length,
          },
          companyId,
        },
      });

      return created;
    });
  }

  async createDraftFromReceipt(
    companyId: string,
    receiptId: string,
    operatorId: string,
  ) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id: receiptId, companyId, status: 'CONFIRMED' },
      include: { lines: { include: { material: true } }, partner: true },
    });
    if (!receipt) throw new NotFoundException('入库单不存在或未确认');

    const existing = await this.prisma.purchaseInvoice.findFirst({
      where: { receiptId, companyId },
      select: { id: true },
    });
    if (existing) {
      this.logger.warn(`入库单 ${receipt.receiptNo} 已关联应付单，跳过`);
      return existing;
    }

    const resolvedTaxCode = await this.taxService.resolveTaxCode(
      companyId,
      null,
    );
    const lineResults: CalculatedVendorBillLine[] = receipt.lines.map(
      (line) => {
        const unitPrice = Number(line.material?.unitPrice ?? 0);
        const lineTotal = this.taxService.round2(line.quantity * unitPrice);
        const breakdown = this.taxService.calcTaxBreakdown(
          lineTotal,
          resolvedTaxCode.rate,
          resolvedTaxCode.isTaxInclusive,
          TaxNature.INPUT,
        );
        return {
          materialId: line.materialId,
          quantity: line.quantity,
          unitPrice,
          lineTotal,
          subTotal: breakdown.subTotal,
          taxAmount: breakdown.taxAmount,
          taxRate: breakdown.taxRate,
          taxCodeId: resolvedTaxCode.id ?? null,
        };
      },
    );

    const totals = this.calculateTotals(lineResults);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseInvoice.create({
        data: {
          invoiceNo: 'VB-' + Date.now(),
          partnerId: receipt.partnerId,
          receiptId,
          amount: totals.totalAmount,
          subTotal: totals.totalSubTotal,
          taxAmount: totals.totalTaxAmount,
          taxRate: resolvedTaxCode.rate,
          taxCodeId: resolvedTaxCode.id ?? null,
          taxNature: TaxNature.INPUT,
          status: 'DRAFT',
          postingStatus: EntryPostingStatus.DRAFT,
          companyId,
          dueDate: new Date(Date.now() + 30 * 86400000),
          notes: `自动生成自入库单 ${receipt.receiptNo}`,
          lines: { create: lineResults },
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'AUTO_CREATE_VENDOR_BILL',
          entity: 'PurchaseInvoice',
          entityId: created.id,
          details: {
            invoiceNo: created.invoiceNo,
            receiptId,
            receiptNo: receipt.receiptNo,
            amount: totals.totalAmount,
          },
          companyId,
        },
      });

      return created;
    });

    this.logger.log(
      `入库单 ${receipt.receiptNo} 自动生成应付草稿 ${invoice.invoiceNo}`,
    );
    return invoice;
  }

  async findAll(companyId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const where = { companyId };
    const [data, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true, code: true } },
          lines: {
            include: {
              material: { select: { id: true, name: true, sku: true } },
            },
          },
          payments: true,
          taxCode: true,
          receipt: { select: { id: true, receiptNo: true } },
        },
        orderBy: { issuedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
      include: {
        partner: true,
        lines: { include: { material: true, taxCode: true } },
        payments: true,
        taxCode: true,
        receipt: { include: { lines: true } },
      },
    });
    if (!invoice) throw new NotFoundException('采购发票不存在');
    return invoice;
  }

  async confirm(companyId: string, id: string, operatorId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, invoiceNo: true },
    });
    if (!invoice) throw new NotFoundException('采购发票不存在');
    if (invoice.status !== 'DRAFT')
      throw new BadRequestException('只有草稿状态的应付单才能确认');

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseInvoice.update({
        where: { id },
        data: { status: 'UNPAID' },
      });
      await tx.auditLog.create({
        data: {
          userId: operatorId,
          action: 'CONFIRM_VENDOR_BILL',
          entity: 'PurchaseInvoice',
          entityId: id,
          details: { invoiceNo: invoice.invoiceNo },
          companyId,
        },
      });
      return result;
    });
  }

  async recordPayment(
    companyId: string,
    invoiceId: string,
    dto: RecordVendorBillPaymentDto,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException('采购发票不存在');
    if (invoice.status === 'DRAFT')
      throw new BadRequestException('请先确认应付单再登记付款');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.vendorBillPayment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          method: dto.method,
          notes: dto.notes ?? null,
        },
      });
      const totalPaid =
        invoice.payments.reduce(
          (sum, paymentItem) => sum + Number(paymentItem.amount),
          0,
        ) + dto.amount;
      let newStatus = invoice.status;
      if (totalPaid >= Number(invoice.amount)) newStatus = 'PAID';
      else if (totalPaid > 0) newStatus = 'PARTIAL';
      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      });
      return payment;
    });
  }

  async post(companyId: string, invoiceId: string, operatorId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        partner: { select: { id: true } },
        taxCode: {
          include: { account: true, outputAccount: true, inputAccount: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('采购发票不存在');

    await this.threeWayMatchService.validateAndPersist(
      companyId,
      invoiceId,
      operatorId,
    );

    if (invoice.postingStatus === EntryPostingStatus.POSTED) {
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        postingStatus: invoice.postingStatus,
        message: '采购发票已过账，无需重复处理',
      };
    }

    const amount = this.taxService.round2(Number(invoice.amount));
    if (amount <= 0) throw new BadRequestException('采购发票金额必须大于0');

    const updated = await this.prisma.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { postingStatus: EntryPostingStatus.POSTED },
    });

    const taxCodeId = invoice.taxCodeId ?? null;
    let taxAccountId: string | null = null;
    if (taxCodeId) {
      const resolved = await this.taxService.resolveTaxCode(
        companyId,
        taxCodeId,
      );
      taxAccountId = this.taxService.getTaxAccountId(resolved);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: operatorId,
        action: 'POST_VENDOR_BILL',
        entity: 'PurchaseInvoice',
        entityId: invoice.id,
        details: {
          invoiceNo: invoice.invoiceNo,
          taxCodeId,
          taxRate: invoice.taxRate,
          taxNature: invoice.taxNature,
          taxAccountId,
          amount,
        },
        companyId,
      },
    });

    this.eventEmitter.emit('finance.vendor_bill.posted', {
      companyId,
      idempotencyKey: 'vendor_bill_posted:' + invoice.id,
      invoiceId: invoice.id,
      taxCodeId,
      taxAccountId,
      taxRate: invoice.taxRate ?? 0.13,
      operatorId,
    });

    return updated;
  }

  private async calculateLines(
    companyId: string,
    lines: Array<{
      materialId: string;
      quantity: number;
      unitPrice: number;
      taxCodeId?: string;
      accountId?: string;
      description?: string;
    }>,
    defaultTaxCode: ResolvedTaxCode,
  ): Promise<CalculatedVendorBillLine[]> {
    const results: CalculatedVendorBillLine[] = [];
    for (const line of lines) {
      const material = await this.prisma.material.findFirst({
        where: { id: line.materialId, companyId },
        select: { id: true },
      });
      if (!material)
        throw new NotFoundException(`物料不存在: ${line.materialId}`);

      const lineTaxCode = line.taxCodeId
        ? await this.taxService.resolveTaxCode(companyId, line.taxCodeId)
        : defaultTaxCode;

      const lineTotal = this.taxService.round2(line.quantity * line.unitPrice);
      const breakdown = this.taxService.calcTaxBreakdown(
        lineTotal,
        lineTaxCode.rate,
        lineTaxCode.isTaxInclusive,
        TaxNature.INPUT,
      );
      results.push({
        materialId: line.materialId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
        subTotal: breakdown.subTotal,
        taxAmount: breakdown.taxAmount,
        taxRate: breakdown.taxRate,
        taxCodeId: lineTaxCode.id ?? null,
        accountId: line.accountId,
        description: line.description,
      });
    }
    return results;
  }

  private calculateTotals(lines: CalculatedVendorBillLine[]) {
    return {
      totalAmount: this.taxService.round2(
        lines.reduce((sum, line) => sum + line.lineTotal, 0),
      ),
      totalSubTotal: this.taxService.round2(
        lines.reduce((sum, line) => sum + line.subTotal, 0),
      ),
      totalTaxAmount: this.taxService.round2(
        lines.reduce((sum, line) => sum + line.taxAmount, 0),
      ),
    };
  }
}
