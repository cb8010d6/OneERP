import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EntryPostingStatus, JournalType, TaxNature, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TaxService } from "../core/tax/tax.service";

interface JournalLineInput {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit?: number;
  credit?: number;
  partnerId?: string;
  memo?: string;
}

interface CreateBalancedEntryInput {
  companyId: string;
  journalCode: string;
  journalName: string;
  journalType: JournalType;
  date?: Date;
  ref?: string;
  description?: string;
  createdBy?: string;
  lines: JournalLineInput[];
}

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxService: TaxService,
  ) {}

  async postStockDepletedEntry(payload: {
    companyId: string;
    referenceNo?: string;
    materialId: string;
    quantity: number;
    unitCost?: number;
    operatorId?: string;
  }) {
    const material = await this.prisma.material.findFirst({
      where: { id: payload.materialId },
      select: { name: true, unitPrice: true },
    });

    const unitCost = Number(payload.unitCost ?? material?.unitPrice ?? 0);
    const amount = this.taxService.round2(unitCost * Number(payload.quantity ?? 0));
    if (amount <= 0) {
      this.logger.warn(
        "跳过零成本库存出库凭�? material=" + payload.materialId,
      );
      return null;
    }

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: "INV",
      journalName: "Inventory Journal",
      journalType: JournalType.INVENTORY,
      ref: payload.referenceNo,
      description: "库存出库自动凭证: " + (material?.name ?? payload.materialId),
      createdBy: payload.operatorId,
      lines: [
        {
          accountCode: "6401",
          accountName: "主营业务成本",
          accountType: "EXPENSE",
          debit: amount,
          memo: "库存出库结转成本",
        },
        {
          accountCode: "1405",
          accountName: "库存商品",
          accountType: "ASSET",
          credit: amount,
          memo: "库存出库结转成本",
        },
      ],
    });
  }

  async postInvoicePostedEntry(payload: {
    companyId: string;
    invoiceId: string;
    taxCodeId?: string | null;
    taxAccountId?: string | null;
    taxRate?: number;
    operatorId?: string;
  }) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: payload.invoiceId, companyId: payload.companyId },
      include: {
        order: { select: { orderNo: true, partnerId: true } },
        taxCode: {
          include: {
            account: true,
            outputAccount: true,
            inputAccount: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new BadRequestException("发票不存在，无法生成凭证");
    }

    const amount = this.taxService.round2(Number(invoice.amount));
    if (amount <= 0) {
      throw new BadRequestException("发票金额必须大于0");
    }

    // 使用发票快照中的价税数据，不重新计算
    let revenue = this.taxService.round2(Number(invoice.subTotal ?? 0));
    let tax = this.taxService.round2(Number(invoice.taxAmount ?? 0));

    if (revenue <= 0 && tax <= 0) {
      // 仅对历史遗留数据做兜�?
      const fallbackRate = Math.max(
        0,
        Math.min(1, Number(invoice.taxRate ?? payload.taxRate ?? invoice.taxCode?.rate ?? 0.13)),
      );
      revenue = this.taxService.round2(amount / (1 + fallbackRate));
      tax = this.taxService.round2(amount - revenue);
      this.logger.warn(
        "发票未包含税额快照，使用兜底税率计算: invoice=" + invoice.invoiceNo,
      );
    }

    // 确定税务科目
    let taxAccountCode = "222101";
    let taxAccountName = "应交税费-销项税";
    let taxAccountType = "LIABILITY";

    if (payload.taxAccountId) {
      const account = await this.prisma.account.findFirst({
        where: { id: payload.taxAccountId, companyId: payload.companyId },
      });
      if (account) {
        taxAccountCode = account.code;
        taxAccountName = account.name;
        taxAccountType = account.type;
      }
    } else if (invoice.taxCode) {
      const tc = invoice.taxCode;
      const nature = (tc.taxNature as TaxNature) ?? TaxNature.OUTPUT;
      const accountId = nature === TaxNature.INPUT
        ? (tc.inputAccountId ?? tc.accountId)
        : (tc.outputAccountId ?? tc.accountId);
      if (accountId) {
        const account = await this.prisma.account.findFirst({
          where: { id: accountId, companyId: payload.companyId },
        });
        if (account) {
          taxAccountCode = account.code;
          taxAccountName = account.name;
          taxAccountType = account.type;
        }
      } else {
        this.logger.warn(
          "未配置税码会计科目，使用默认销项税科目: invoice=" + invoice.invoiceNo,
        );
      }
    }

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: "SAL",
      journalName: "Sales Journal",
      journalType: JournalType.SALES,
      ref: invoice.invoiceNo,
      description: "销售开票自动凭�? " + invoice.invoiceNo,
      createdBy: payload.operatorId,
      lines: [
        {
          accountCode: "1122",
          accountName: "应收账款",
          accountType: "ASSET",
          debit: amount,
          partnerId: invoice.order.partnerId,
          memo: "应收 " + invoice.invoiceNo,
        },
        {
          accountCode: "6001",
          accountName: "主营业务收入",
          accountType: "REVENUE",
          credit: revenue,
          partnerId: invoice.order.partnerId,
          memo: "收入 " + invoice.invoiceNo,
        },
        {
          accountCode: taxAccountCode,
          accountName: taxAccountName,
          accountType: taxAccountType,
          credit: tax,
          memo: "销项税 " + invoice.invoiceNo,
        },
      ],
    });
  }

  async postVendorBillPostedEntry(payload: {
    companyId: string;
    invoiceId: string;
    taxCodeId?: string | null;
    taxAccountId?: string | null;
    taxRate?: number;
    operatorId?: string;
  }) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: payload.invoiceId, companyId: payload.companyId },
      include: {
        partner: { select: { id: true, name: true } },
        taxCode: { include: { account: true, outputAccount: true, inputAccount: true } },
        lines: { include: { account: true } },
      },
    });
    if (!invoice) throw new BadRequestException('Purchase invoice not found');

    const amount = this.taxService.round2(Number(invoice.amount));
    if (amount <= 0) throw new BadRequestException('Purchase invoice amount must be > 0');

    let subTotal = this.taxService.round2(Number(invoice.subTotal ?? 0));
    let taxAmount = this.taxService.round2(Number(invoice.taxAmount ?? 0));
    if (subTotal <= 0 && taxAmount <= 0) {
      const fallbackRate = Math.max(0, Math.min(1, Number(invoice.taxRate ?? payload.taxRate ?? invoice.taxCode?.rate ?? 0.13)));
      subTotal = this.taxService.round2(amount / (1 + fallbackRate));
      taxAmount = this.taxService.round2(amount - subTotal);
      this.logger.warn('Purchase invoice missing tax snapshot, using fallback rate: ' + invoice.invoiceNo);
    }

    // ---- Resolve input tax account ----
    let taxAccountCode = '222102';
    let taxAccountName = 'Tax Payable - Input Tax';
    let taxAccountType = 'LIABILITY';
    if (payload.taxAccountId) {
      const account = await this.prisma.account.findFirst({ where: { id: payload.taxAccountId, companyId: payload.companyId } });
      if (account) { taxAccountCode = account.code; taxAccountName = account.name; taxAccountType = account.type; }
    } else if (invoice.taxCode) {
      const tc = invoice.taxCode;
      const nature = (tc.taxNature as TaxNature) ?? TaxNature.INPUT;
      const accountId = nature === TaxNature.INPUT ? (tc.inputAccountId ?? tc.accountId) : (tc.outputAccountId ?? tc.accountId);
      if (accountId) {
        const account = await this.prisma.account.findFirst({ where: { id: accountId, companyId: payload.companyId } });
        if (account) { taxAccountCode = account.code; taxAccountName = account.name; taxAccountType = account.type; }
      }
    }

    // ---- Build debit lines by line-level account (inventory / expense) ----
    const debitLines = this.buildPurchaseDebitLines(
      invoice.lines,
      invoice.invoiceNo,
      invoice.partnerId,
      subTotal,
    );

    return this.createBalancedEntry({
      companyId: payload.companyId,
      journalCode: 'PUR',
      journalName: 'Purchase Journal',
      journalType: JournalType.PURCHASE,
      ref: invoice.invoiceNo,
      description: 'Purchase AP auto-entry: ' + invoice.invoiceNo,
      createdBy: payload.operatorId,
      lines: [
        ...debitLines,
        { accountCode: taxAccountCode, accountName: taxAccountName, accountType: taxAccountType, debit: taxAmount, memo: 'Input Tax ' + invoice.invoiceNo },
        { accountCode: '2202', accountName: 'Accounts Payable', accountType: 'LIABILITY', credit: amount, partnerId: invoice.partnerId, memo: 'AP ' + invoice.invoiceNo },
      ],
    });
  }

  /**
   * Build debit journal lines from purchase invoice lines.
   * Uses line-level accountId (inventory or expense); defaults to 1401.
   * Merges lines sharing the same account code into a single debit line.
   */
  private buildPurchaseDebitLines(
    lines: Array<{
      subTotal: number;
      accountId?: string | null;
      account?: { code: string; name: string; type: string } | null;
    }>,
    invoiceNo: string,
    partnerId: string,
    fallbackSubTotal: number,
  ): JournalLineInput[] {
    const accountMap = new Map<string, { code: string; name: string; type: string; amount: number }>();

    if (lines.length > 0) {
      for (const line of lines) {
        const lineSubTotal = this.taxService.round2(Number(line.subTotal ?? 0));
        if (lineSubTotal <= 0) continue;

        if (line.account) {
          const key = line.account.code;
          const existing = accountMap.get(key);
          if (existing) {
            existing.amount = this.taxService.round2(existing.amount + lineSubTotal);
          } else {
            accountMap.set(key, { code: line.account.code, name: line.account.name, type: line.account.type, amount: lineSubTotal });
          }
        } else {
          const key = '1401';
          const existing = accountMap.get(key);
          if (existing) {
            existing.amount = this.taxService.round2(existing.amount + lineSubTotal);
          } else {
            accountMap.set(key, { code: '1401', name: 'Inventory/Raw Materials', type: 'ASSET', amount: lineSubTotal });
          }
        }
      }
    }

    // Fallback: if no line-level data, use invoice-level subTotal
    if (accountMap.size === 0) {
      accountMap.set('1401', { code: '1401', name: 'Inventory/Raw Materials', type: 'ASSET', amount: fallbackSubTotal });
    }

    const result: JournalLineInput[] = [];
    for (const entry of accountMap.values()) {
      if (entry.amount > 0) {
        result.push({
          accountCode: entry.code,
          accountName: entry.name,
          accountType: entry.type,
          debit: entry.amount,
          partnerId,
          memo: 'Purchase ' + invoiceNo,
        });
      }
    }
    return result;
  }  async createBalancedEntry(input: CreateBalancedEntryInput) {
    await this.ensureDefaultMasterData(input.companyId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        "journal-entry-" + input.companyId,
      );

      const lines = input.lines.map((line) => ({
        ...line,
        debit: this.taxService.round2(Number(line.debit ?? 0)),
        credit: this.taxService.round2(Number(line.credit ?? 0)),
      }));

      this.validateLines(lines);
      const totalDebit = this.taxService.round2(
        lines.reduce((sum, line) => sum + line.debit, 0),
      );
      const totalCredit = this.taxService.round2(
        lines.reduce((sum, line) => sum + line.credit, 0),
      );

      if (totalDebit !== totalCredit) {
        throw new BadRequestException(
          "借贷不平�? debit=" + totalDebit + ", credit=" + totalCredit,
        );
      }

      const journal = await tx.journal.upsert({
        where: {
          companyId_code: {
            companyId: input.companyId,
            code: input.journalCode,
          },
        },
        update: {
          name: input.journalName,
          type: input.journalType,
          isActive: true,
        },
        create: {
          companyId: input.companyId,
          code: input.journalCode,
          name: input.journalName,
          type: input.journalType,
        },
      });

      const entry = await tx.journalEntry.create({
        data: {
          entryNo: this.generateEntryNo(),
          date: input.date ?? new Date(),
          ref: input.ref,
          description: input.description,
          journalId: journal.id,
          companyId: input.companyId,
          createdBy: input.createdBy,
          postingStatus: EntryPostingStatus.POSTED,
          postedAt: new Date(),
          lines: {
            create: await Promise.all(
              lines.map(async (line, index) => {
                const account = await this.ensureAccount(
                  tx,
                  input.companyId,
                  line.accountCode,
                  line.accountName,
                  line.accountType,
                );

                return {
                  lineNo: index + 1,
                  accountId: account.id,
                  partnerId: line.partnerId,
                  debit: line.debit,
                  credit: line.credit,
                  memo: line.memo,
                };
              }),
            ),
          },
        },
        include: {
          lines: {
            include: { account: true },
            orderBy: { lineNo: "asc" },
          },
          journal: true,
        },
      });

      return {
        ...entry,
        totals: {
          debit: totalDebit,
          credit: totalCredit,
        },
      };
    });
  }

  private async ensureDefaultMasterData(companyId: string) {
    await this.prisma.journal.upsert({
      where: { companyId_code: { companyId, code: "GEN" } },
      update: {
        name: "General Journal",
        type: JournalType.GENERAL,
        isActive: true,
      },
      create: {
        companyId,
        code: "GEN",
        name: "General Journal",
        type: JournalType.GENERAL,
      },
    });
  }

  private async ensureAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    code: string,
    name: string,
    type: string,
  ) {
    return tx.account.upsert({
      where: {
        companyId_code: {
          companyId,
          code,
        },
      },
      update: {
        name,
        type,
        isActive: true,
      },
      create: {
        companyId,
        code,
        name,
        type,
      },
    });
  }

  private validateLines(lines: Array<{ debit: number; credit: number }>) {
    if (!lines.length) {
      throw new BadRequestException("凭证分录不能为空");
    }

    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new BadRequestException("分录金额不能为负数");
      }
      if (
        (line.debit === 0 && line.credit === 0) ||
        (line.debit > 0 && line.credit > 0)
      ) {
        throw new BadRequestException("每行分录必须仅填写借方或贷方");
      }
    }
  }

  private generateEntryNo() {
    const now = new Date();
    const datePart = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
    const suffix = String(now.getTime()).slice(-6);
    return "JE-" + datePart + "-" + suffix;
  }
}