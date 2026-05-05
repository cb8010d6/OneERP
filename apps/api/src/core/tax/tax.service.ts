import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TaxNature, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 税码解析结果，附带 fallback 标记 */
export interface ResolvedTaxCode {
  id: string | null;
  code: string;
  name: string;
  rate: number;
  isTaxInclusive: boolean;
  taxNature: TaxNature;
  outputAccountId: string | null;
  inputAccountId: string | null;
  /** legacy 兼容字段 */
  accountId: string | null;
  isFallback: boolean;
}

/** 含税/未税计算结果 */
export interface TaxBreakdown {
  subTotal: number;
  taxAmount: number;
  total: number;
  taxRate: number;
  taxNature: TaxNature;
}

/**
 * 统一税码服务 —— 唯一的税率解析 & 价税计算入口。
 *
 * 设计原则:
 * 1. 所有模块（Order / Invoice / PurchaseInvoice）调用此服务解析税码和计算税额。
 * 2. fallback 到 13% 硬编码税率时写入 AuditLog 并返回 isFallback=true。
 * 3. 过账（posting）时禁止重新按当前税率覆盖历史快照金额 —— 由调用方保证。
 */
@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── 数值精度工具 ───────────────────────────────────

  round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  // ─── 税码解析 ───────────────────────────────────────

  /**
   * 解析税码。
   * 优先使用显式 taxCodeId → 回退到公司默认税码 → 硬编码 13% 兜底。
   * 兜底时写入 AuditLog（仅当 auditContext 存在时）。
   */
  async resolveTaxCode(
    companyId: string,
    taxCodeId?: string | null,
    auditContext?: { operatorId: string; entity: string; entityId: string },
  ): Promise<ResolvedTaxCode> {
    // 1. 显式指定
    if (taxCodeId) {
      const taxCode = await this.prisma.taxCode.findFirst({
        where: { id: taxCodeId, companyId, active: true },
      });
      if (!taxCode) {
        throw new BadRequestException('税码不存在或已停用，请确认税码选择');
      }
      return this.toResolved(taxCode, false);
    }

    // 2. 公司默认税码
    const defaultTaxCode = await this.prisma.taxCode.findFirst({
      where: { companyId, isDefault: true, active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (defaultTaxCode) {
      return this.toResolved(defaultTaxCode, false);
    }

    // 3. 硬编码兜底
    this.logger.warn(
      `未配置默认税码，使用 13% 默认税率兜底: companyId=${companyId}`,
    );

    if (auditContext) {
      await this.prisma.auditLog.create({
        data: {
          userId: auditContext.operatorId,
          action: 'TAX_FALLBACK',
          entity: auditContext.entity,
          entityId: auditContext.entityId,
          details: {
            reason: '未配置默认税码',
            fallbackRate: 0.13,
            companyId,
          },
          companyId,
        },
      });
    }

    return {
      id: null,
      code: 'FALLBACK_13',
      name: '默认税率 13%',
      rate: 0.13,
      isTaxInclusive: true,
      taxNature: TaxNature.OUTPUT,
      outputAccountId: null,
      inputAccountId: null,
      accountId: null,
      isFallback: true,
    };
  }

  /**
   * 根据 taxNature 获取对应的税务科目 ID：
   * OUTPUT → outputAccountId，INPUT → inputAccountId。
   * 如果对应字段为空，回退到 accountId（兼容旧数据）。
   */
  getTaxAccountId(
    resolved: ResolvedTaxCode,
    taxNature?: TaxNature,
  ): string | null {
    const nature = taxNature ?? resolved.taxNature;
    if (nature === TaxNature.INPUT) {
      return resolved.inputAccountId ?? resolved.accountId;
    }
    return resolved.outputAccountId ?? resolved.accountId;
  }

  // ─── 价税计算 ───────────────────────────────────────

  /**
   * 含税/未税统一计算。
   * @param baseAmount   基础金额（含税金额或未税金额，取决于 isTaxInclusive）
   * @param taxRate      税率 (0-1)
   * @param isTaxInclusive true=含税价，false=未税价
   */
  calcTaxBreakdown(
    baseAmount: number,
    taxRate: number,
    isTaxInclusive: boolean,
    taxNature: TaxNature = TaxNature.OUTPUT,
  ): TaxBreakdown {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));

    if (isTaxInclusive) {
      const subTotal = this.round2(baseAmount / (1 + safeRate));
      const taxAmount = this.round2(baseAmount - subTotal);
      return {
        subTotal,
        taxAmount,
        total: this.round2(baseAmount),
        taxRate: safeRate,
        taxNature,
      };
    }

    const subTotal = this.round2(baseAmount);
    const taxAmount = this.round2(subTotal * safeRate);
    const total = this.round2(subTotal + taxAmount);
    return { subTotal, taxAmount, total, taxRate: safeRate, taxNature };
  }

  /**
   * 从含税总价反算 —— 兼容 FinanceService 的旧接口。
   */
  calcTaxFromTotal(
    total: number,
    taxRate: number,
    taxNature: TaxNature = TaxNature.OUTPUT,
  ): TaxBreakdown {
    const safeRate = Math.max(0, Math.min(1, Number(taxRate ?? 0)));
    const subTotal = this.round2(total / (1 + safeRate));
    const taxAmount = this.round2(total - subTotal);
    return { subTotal, taxAmount, total: this.round2(total), taxRate: safeRate, taxNature };
  }

  // ─── 内部方法 ──────────────────────────────────────

  private toResolved(
    tc: {
      id: string;
      code: string;
      name: string;
      rate: number;
      isTaxInclusive: boolean;
      taxNature: TaxNature;
      outputAccountId: string | null;
      inputAccountId: string | null;
      accountId: string | null;
    },
    isFallback: boolean,
  ): ResolvedTaxCode {
    return {
      id: tc.id,
      code: tc.code,
      name: tc.name,
      rate: Number(tc.rate),
      isTaxInclusive: tc.isTaxInclusive,
      taxNature: tc.taxNature,
      outputAccountId: tc.outputAccountId,
      inputAccountId: tc.inputAccountId,
      accountId: tc.accountId,
      isFallback,
    };
  }
}
