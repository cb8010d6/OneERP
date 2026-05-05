import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ThreeWayMatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_TOLERANCE_RATE = 0.05;
const DEFAULT_TOLERANCE_ABS = 0.01;

export interface MatchLineDetail {
  materialId: string;
  materialName?: string;
  poQuantity: number;
  poUnitPrice: number;
  poSubTotal: number;
  poTaxAmount: number;
  poTotalAmount: number;
  grQuantity: number;
  billQuantity: number;
  billUnitPrice: number;
  billSubTotal: number;
  billTaxAmount: number;
  billTotalAmount: number;
  quantityDiff: number;
  amountDiff: number;
  taxDiff: number;
  matched: boolean;
  reasons: string[];
}

export interface ThreeWayMatchResult {
  invoiceId: string;
  invoiceNo: string;
  status: ThreeWayMatchStatus;
  overallMatched: boolean;
  lines: MatchLineDetail[];
  summary: {
    totalPoAmount: number;
    totalGrQuantity: number;
    totalBillAmount: number;
    totalBillTax: number;
    amountDifference: number;
    taxDifference: number;
    mismatchedLineCount: number;
    totalLineCount: number;
  };
  checkedAt: Date;
}

@Injectable()
export class ThreeWayMatchService {
  private readonly logger = new Logger(ThreeWayMatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  private round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private buildNotApplicableResult(invoiceId: string, invoiceNo: string): ThreeWayMatchResult {
    return {
      invoiceId, invoiceNo,
      status: ThreeWayMatchStatus.NOT_APPLICABLE,
      overallMatched: true, lines: [],
      summary: { totalPoAmount: 0, totalGrQuantity: 0, totalBillAmount: 0, totalBillTax: 0, amountDifference: 0, taxDifference: 0, mismatchedLineCount: 0, totalLineCount: 0 },
      checkedAt: new Date(),
    };
  }

  async validateMatch(companyId: string, invoiceId: string, toleranceRate = DEFAULT_TOLERANCE_RATE, toleranceAbs = DEFAULT_TOLERANCE_ABS): Promise<ThreeWayMatchResult> {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        lines: { include: { material: { select: { id: true, name: true, sku: true } } } },
        receipt: { include: { lines: true, order: { include: { lines: { include: { material: { select: { id: true, name: true } } } } } } } },
      },
    });
    if (!invoice) throw new NotFoundException('采购发票不存在');
    if (!invoice.receiptId || !invoice.receipt) {
      this.logger.warn(`发票 ${invoice.invoiceNo} 未关联入库单，跳过三单匹配`);
      return this.buildNotApplicableResult(invoice.id, invoice.invoiceNo);
    }
    const receipt = invoice.receipt;
    const po = receipt.order;
    if (!po) {
      this.logger.warn(`入库单 ${receipt.receiptNo} 未关联采购订单，跳过三单匹配`);
      return this.buildNotApplicableResult(invoice.id, invoice.invoiceNo);
    }
    const poLinesByMat = new Map<string, typeof po.lines>();
    for (const pl of po.lines) {
      if (!pl.materialId) continue;
      if (!poLinesByMat.has(pl.materialId)) poLinesByMat.set(pl.materialId, []);
      poLinesByMat.get(pl.materialId)!.push(pl);
    }
    const grQtyByMat = new Map<string, number>();
    for (const gl of receipt.lines) {
      grQtyByMat.set(gl.materialId, (grQtyByMat.get(gl.materialId) ?? 0) + gl.quantity);
    }
    const lineDetails: MatchLineDetail[] = [];
    let totalPoAmount = 0, totalGrQty = 0, totalBillAmount = 0, totalBillTax = 0;
    for (const bl of invoice.lines) {
      const matId = bl.materialId;
      const poLines = poLinesByMat.get(matId);
      let poQty = 0, poPrice = 0, poSub = 0, poTax = 0, poTotal = 0;
      if (poLines?.length) {
        for (const pl of poLines) { poQty += pl.quantity; poPrice = pl.unitPrice; poSub += pl.subTotal; poTax += pl.taxAmount; poTotal += pl.totalAmount; }
      }
      const grQty = grQtyByMat.get(matId) ?? 0;
      const qtyDiff = bl.quantity - poQty;
      const amtDiff = this.round2(bl.lineTotal - poTotal);
      const txDiff = this.round2(bl.taxAmount - poTax);
      totalPoAmount += poTotal; totalGrQty += grQty; totalBillAmount += bl.lineTotal; totalBillTax += bl.taxAmount;
      const reasons: string[] = [];
      if (grQty > poQty + toleranceAbs) reasons.push(`GR收货数量(${grQty})超过PO采购数量(${poQty})`);
      if (bl.quantity > poQty + toleranceAbs) reasons.push(`开票数量(${bl.quantity})超过PO采购数量(${poQty})`);
      if (poTotal > 0 && Math.abs(amtDiff) > toleranceAbs && Math.abs(amtDiff / poTotal) > toleranceRate) reasons.push(`开票金额(${bl.lineTotal})与PO金额(${poTotal})差异超限: ${this.round2(Math.abs(amtDiff / poTotal) * 100)}%`);
      if (poTax > 0 && Math.abs(txDiff) > toleranceAbs && Math.abs(txDiff / poTax) > toleranceRate) reasons.push(`开票税额(${bl.taxAmount})与PO税额(${poTax})差异超限: ${this.round2(Math.abs(txDiff / poTax) * 100)}%`);
      lineDetails.push({
        materialId: matId, materialName: bl.material?.name, poQuantity: poQty, poUnitPrice: poPrice,
        poSubTotal: this.round2(poSub), poTaxAmount: this.round2(poTax), poTotalAmount: this.round2(poTotal),
        grQuantity: grQty, billQuantity: bl.quantity, billUnitPrice: bl.unitPrice,
        billSubTotal: this.round2(bl.subTotal), billTaxAmount: this.round2(bl.taxAmount), billTotalAmount: this.round2(bl.lineTotal),
        quantityDiff: this.round2(qtyDiff), amountDiff: this.round2(amtDiff), taxDiff: this.round2(txDiff),
        matched: reasons.length === 0, reasons,
      });
    }
    for (const [matId, pls] of poLinesByMat) {
      if (invoice.lines.some((l) => l.materialId === matId)) continue;
      const pQty = pls.reduce((s, l) => s + l.quantity, 0);
      const pAmt = pls.reduce((s, l) => s + l.totalAmount, 0);
      if (pQty > 0 && pAmt > 0) {
        lineDetails.push({
          materialId: matId, materialName: pls[0]?.material?.name, poQuantity: pQty, poUnitPrice: pls[0]?.unitPrice ?? 0,
          poSubTotal: this.round2(pls.reduce((s, l) => s + l.subTotal, 0)),
          poTaxAmount: this.round2(pls.reduce((s, l) => s + l.taxAmount, 0)), poTotalAmount: this.round2(pAmt),
          grQuantity: grQtyByMat.get(matId) ?? 0, billQuantity: 0, billUnitPrice: 0, billSubTotal: 0, billTaxAmount: 0, billTotalAmount: 0,
          quantityDiff: this.round2(-pQty), amountDiff: this.round2(-pAmt), taxDiff: this.round2(-pls.reduce((s, l) => s + l.taxAmount, 0)),
          matched: false, reasons: [`PO行项(物料${matId})在发票中缺失`],
        });
      }
    }
    const mismatched = lineDetails.filter((l) => !l.matched).length;
    const overall = mismatched === 0;
    return {
      invoiceId: invoice.id, invoiceNo: invoice.invoiceNo,
      status: overall ? ThreeWayMatchStatus.MATCHED : ThreeWayMatchStatus.MISMATCH,
      overallMatched: overall, lines: lineDetails,
      summary: {
        totalPoAmount: this.round2(totalPoAmount), totalGrQuantity: this.round2(totalGrQty),
        totalBillAmount: this.round2(totalBillAmount), totalBillTax: this.round2(totalBillTax),
        amountDifference: this.round2(totalBillAmount - totalPoAmount),
        taxDifference: this.round2(totalBillTax - lineDetails.reduce((s, l) => s + l.poTaxAmount, 0)),
        mismatchedLineCount: mismatched, totalLineCount: lineDetails.length,
      },
      checkedAt: new Date(),
    };
  }

  async validateAndPersist(companyId: string, invoiceId: string, operatorId: string, toleranceRate?: number, toleranceAbs?: number): Promise<ThreeWayMatchResult> {
    const result = await this.validateMatch(companyId, invoiceId, toleranceRate, toleranceAbs);
    await this.prisma.purchaseInvoice.update({ where: { id: invoiceId }, data: { matchStatus: result.status } });
    await this.prisma.auditLog.create({
      data: {
        userId: operatorId, action: 'THREE_WAY_MATCH', entity: 'PurchaseInvoice', entityId: invoiceId,
        details: {
          status: result.status, overallMatched: result.overallMatched, summary: result.summary,
          mismatchedLines: result.lines.filter((l) => !l.matched).map((l) => ({ materialId: l.materialId, reasons: l.reasons })),
        },
        companyId,
      },
    });
    if (!result.overallMatched) {
      const mismatchedReasons = result.lines.filter((l) => !l.matched).flatMap((l) => l.reasons);
      throw new BadRequestException(`三单匹配失败，无法过账。差异明细:\n${mismatchedReasons.join('\n')}`);
    }
    return result;
  }
}
