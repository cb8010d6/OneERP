import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { FinanceDlqService } from './finance-dlq.service';
import { FinanceAccountMappingService } from './finance-account-mapping.service';
import { AccountingPeriodService } from './accounting-period.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import {
  CreateInvoiceDto,
  CreatePaymentDto,
  CreateReceivablePaymentDto,
  ApplyReceivablePaymentDto,
  CreateCreditNoteDto,
  CreateCustomerRefundDto,
  ImportBankStatementLinesDto,
  MatchBankStatementLineDto,
  PostInvoiceDto,
} from './dto/finance.dto';
import { UpdateFinanceAccountMappingsDto } from './dto/finance-account-mapping.dto';
import {
  AccountingPeriodStatusQueryDto,
  UpsertAccountingPeriodDto,
} from './dto/accounting-period.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('财务管理 (Finance)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly financeDlqService: FinanceDlqService,
    private readonly financeAccountMappingService: FinanceAccountMappingService,
    private readonly accountingPeriodService: AccountingPeriodService,
  ) {}

  @Post('invoices')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '创建应收发票' })
  async createInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.financeService.createInvoice(companyId, dto, user.id);
  }

  @Get('invoices')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '获取发票列表' })
  async getInvoices(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.financeService.getInvoices(companyId, pagination);
  }

  @Get('account-mappings')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '获取公司级财务科目映射' })
  async getAccountMappings(@CurrentCompany() companyId: string) {
    return this.financeAccountMappingService.list(companyId);
  }

  @Get('account-options')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '获取可用于财务映射的会计科目' })
  async getAccountOptions(@CurrentCompany() companyId: string) {
    return this.financeAccountMappingService.listAccountOptions(companyId);
  }

  @Post('account-mappings')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '更新公司级财务科目映射' })
  async updateAccountMappings(
    @CurrentCompany() companyId: string,
    @Body() dto: UpdateFinanceAccountMappingsDto,
  ) {
    return this.financeAccountMappingService.update(companyId, dto);
  }

  @Get('accounting-periods')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '查看会计期间与关账状态' })
  async getAccountingPeriods(
    @CurrentCompany() companyId: string,
    @Query() query: AccountingPeriodStatusQueryDto,
  ) {
    return this.accountingPeriodService.list(companyId, query.status);
  }

  @Post('accounting-periods')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '创建或更新会计期间' })
  async upsertAccountingPeriod(
    @CurrentCompany() companyId: string,
    @Body() dto: UpsertAccountingPeriodDto,
  ) {
    return this.accountingPeriodService.upsert(companyId, dto);
  }

  @Post('accounting-periods/:periodKey/close')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '关账会计期间' })
  async closeAccountingPeriod(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('periodKey') periodKey: string,
  ) {
    return this.accountingPeriodService.close(companyId, periodKey, user.id);
  }

  @Post('accounting-periods/:periodKey/reopen')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '重开会计期间' })
  async reopenAccountingPeriod(
    @CurrentCompany() companyId: string,
    @Param('periodKey') periodKey: string,
  ) {
    return this.accountingPeriodService.reopen(companyId, periodKey);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '登记发票收款' })
  async recordPayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') invoiceId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.financeService.recordPayment(
      companyId,
      invoiceId,
      dto,
      user.id,
    );
  }

  @Post('payments')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '登记客户收款并分配核销到应收发票' })
  async recordReceivablePayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateReceivablePaymentDto,
  ) {
    return this.financeService.recordReceivablePayment(companyId, dto, user.id);
  }

  @Post('payments/:id/allocations')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '将未分配收款核销到应收发票' })
  async applyReceivablePayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') paymentId: string,
    @Body() dto: ApplyReceivablePaymentDto,
  ) {
    return this.financeService.applyReceivablePayment(
      companyId,
      paymentId,
      dto,
      user.id,
    );
  }

  @Post('invoices/:id/post')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '发票过账（触发收入凭证生成）' })
  async postInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') invoiceId: string,
    @Body() dto: PostInvoiceDto,
  ) {
    return this.financeService.postInvoice(
      companyId,
      invoiceId,
      user.id,
      dto.taxCodeId,
      dto.taxRate,
    );
  }

  @Get('trial-balance')
  @RequirePermissions(Permission.FinanceTrialBalanceRead)
  @ApiOperation({ summary: '试算平衡表（已过账凭证）' })
  async getTrialBalance(
    @CurrentCompany() companyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.financeService.getTrialBalance(companyId, startDate, endDate);
  }

  @Get('general-ledger')
  @RequirePermissions(Permission.FinanceTrialBalanceRead)
  @ApiOperation({ summary: '总账明细账（科目期初、本期发生与逐笔余额）' })
  async getGeneralLedger(
    @CurrentCompany() companyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountCode') accountCode?: string,
  ) {
    return this.financeService.getGeneralLedger(
      companyId,
      startDate,
      endDate,
      accountCode,
    );
  }

  @Get('income-statement')
  @RequirePermissions(Permission.FinanceTrialBalanceRead)
  @ApiOperation({ summary: '损益表（收入、费用与净利润）' })
  async getIncomeStatement(
    @CurrentCompany() companyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.financeService.getIncomeStatement(
      companyId,
      startDate,
      endDate,
    );
  }

  @Get('balance-sheet')
  @RequirePermissions(Permission.FinanceTrialBalanceRead)
  @ApiOperation({ summary: '资产负债表（资产、负债、权益与未结转损益）' })
  async getBalanceSheet(
    @CurrentCompany() companyId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.financeService.getBalanceSheet(companyId, asOfDate);
  }

  @Get('cash-flow')
  @RequirePermissions(Permission.FinanceTrialBalanceRead)
  @ApiOperation({ summary: '现金流量表（现金类科目期间流入流出）' })
  async getCashFlowStatement(
    @CurrentCompany() companyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.financeService.getCashFlowStatement(
      companyId,
      startDate,
      endDate,
    );
  }

  @Get('inventory-valuation')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '库存估值与总账库存科目对账' })
  async getInventoryValuation(@CurrentCompany() companyId: string) {
    return this.financeService.getInventoryValuationReconciliation(companyId);
  }

  @Get('receivables-aging')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '应收账龄分析' })
  async getReceivableAging(
    @CurrentCompany() companyId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.financeService.getReceivableAging(companyId, asOfDate);
  }

  @Get('unapplied-payments')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '未分配客户收款' })
  async getUnappliedPayments(@CurrentCompany() companyId: string) {
    return this.financeService.getUnappliedPayments(companyId);
  }

  @Post('bank-statements/import')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '导入银行流水' })
  async importBankStatementLines(
    @CurrentCompany() companyId: string,
    @Body() dto: ImportBankStatementLinesDto,
  ) {
    return this.financeService.importBankStatementLines(companyId, dto);
  }

  @Get('bank-statements')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '查看银行流水与匹配状态' })
  async getBankStatementLines(
    @CurrentCompany() companyId: string,
    @Query('status') status?: string,
  ) {
    return this.financeService.getBankStatementLines(companyId, status);
  }

  @Post('bank-statements/auto-match')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '自动匹配唯一候选银行流水' })
  async autoMatchBankStatementLines(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.financeService.autoMatchBankStatementLines(companyId, user.id);
  }

  @Post('bank-statements/:id/match')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '匹配银行流水到客户收款或供应商付款' })
  async matchBankStatementLine(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') bankStatementLineId: string,
    @Body() dto: MatchBankStatementLineDto,
  ) {
    return this.financeService.matchBankStatementLine(
      companyId,
      bankStatementLineId,
      dto,
      user.id,
    );
  }

  @Post('credit-notes')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '创建应收贷项/红字凭证草稿' })
  async createCreditNote(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.financeService.createCreditNote(companyId, dto, user.id);
  }

  @Get('credit-notes')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '获取应收贷项/红字凭证列表' })
  async getCreditNotes(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.financeService.getCreditNotes(companyId, pagination);
  }

  @Post('credit-notes/:id/post')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '贷项/红字凭证过账并冲减应收' })
  async postCreditNote(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') creditNoteId: string,
  ) {
    return this.financeService.postCreditNote(companyId, creditNoteId, user.id);
  }

  @Post('customer-refunds')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '创建客户退款单草稿' })
  async createCustomerRefund(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateCustomerRefundDto,
  ) {
    return this.financeService.createCustomerRefund(companyId, dto, user.id);
  }

  @Get('customer-refunds')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '获取客户退款单列表' })
  async getCustomerRefunds(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.financeService.getCustomerRefunds(companyId, pagination);
  }

  @Post('customer-refunds/:id/post')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '客户退款单过账并冲减应退客户款' })
  async postCustomerRefund(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') refundId: string,
  ) {
    return this.financeService.postCustomerRefund(companyId, refundId, user.id);
  }

  @Get('dlq')
  @RequirePermissions(Permission.FinanceRead)
  @ApiOperation({ summary: '查看财务事件补偿队列' })
  async getDlq(
    @CurrentCompany() companyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.financeDlqService.list(Number(limit ?? 50), companyId);
  }

  @Post('dlq/retry')
  @RequirePermissions(Permission.FinancePost)
  @ApiOperation({ summary: '重试财务事件补偿队列' })
  async retryDlq(
    @CurrentCompany() companyId: string,
    @Body() body?: { limit?: number; eventNames?: unknown[] },
  ) {
    const eventNames =
      body && Array.isArray(body.eventNames)
        ? body.eventNames.filter(
            (eventName): eventName is string => typeof eventName === 'string',
          )
        : undefined;
    return this.financeDlqService.retryPending(
      body?.limit ?? 20,
      companyId,
      eventNames,
    );
  }
}
