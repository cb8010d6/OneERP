import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { FinanceDlqService } from './finance-dlq.service';
import { AccountingService } from './accounting.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { RequirePermissions } from '../core/decorators/require-permissions.decorator';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { CreateInvoiceDto, CreatePaymentDto } from './dto/finance.dto';
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
    private readonly accountingService: AccountingService,
  ) {}

  @Post('invoices')
  @ApiOperation({ summary: '创建应收发票' })
  async createInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.financeService.createInvoice(companyId, dto, user.id);
  }

  @Get('invoices')
  @ApiOperation({ summary: '获取发票列表' })
  async getInvoices(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.financeService.getInvoices(companyId, pagination);
  }

  @Post('invoices/:id/payments')
  @ApiOperation({ summary: '登记发票收款' })
  async recordPayment(
    @CurrentCompany() companyId: string,
    @Param('id') invoiceId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.financeService.recordPayment(companyId, invoiceId, dto);
  }

  @Post('invoices/:id/post')
  @ApiOperation({ summary: '发票过账（触发收入凭证生成）' })
  @RequirePermissions('finance:post', 'finance:write')
  async postInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') invoiceId: string,
  ) {
    return this.financeService.postInvoice(companyId, invoiceId, user.id);
  }

  // ─── 凭证管理 ────────────────────────────────────

  @Get('journal-entries')
  @ApiOperation({ summary: '获取凭证列表' })
  @ApiQuery({ name: 'status', required: false, description: '过账状态过滤' })
  async getJournalEntries(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
    @Query('status') status?: string,
  ) {
    return this.financeService.getJournalEntries(companyId, pagination, status);
  }

  @Post('journal-entries/:id/reverse')
  @ApiOperation({
    summary: '冲销凭证（生成反向借贷分录，原凭证标记 REVERSED）',
  })
  @RequirePermissions('finance:reverse', 'finance:write')
  async reverseJournalEntry(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') entryId: string,
    @Body() body: { reason?: string },
  ) {
    return this.accountingService.reverseJournalEntry(
      companyId,
      entryId,
      user.id,
      body?.reason,
    );
  }

  // ─── 试算平衡表 ──────────────────────────────────

  @Get('trial-balance')
  @ApiOperation({ summary: '试算平衡表（按科目聚合已过账凭证借贷合计）' })
  @ApiQuery({ name: 'startDate', required: false, description: '起始日期 ISO' })
  @ApiQuery({ name: 'endDate', required: false, description: '结束日期 ISO' })
  @ApiQuery({
    name: 'accountType',
    required: false,
    description: 'ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE',
  })
  async getTrialBalance(
    @CurrentCompany() companyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('accountType') accountType?: string,
  ) {
    return this.accountingService.getTrialBalance(
      companyId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      accountType,
    );
  }

  // ─── DLQ ─────────────────────────────────────────

  @Get('dlq')
  @ApiOperation({ summary: '查看财务事件补偿队列' })
  async getDlq(@Query('limit') limit?: string) {
    return this.financeDlqService.list(Number(limit ?? 50));
  }

  @Post('dlq/retry')
  @ApiOperation({ summary: '重试财务事件补偿队列' })
  @RequirePermissions('finance:admin')
  async retryDlq(@Body() body?: { limit?: number }) {
    return this.financeDlqService.retryPending(body?.limit ?? 20);
  }
}
