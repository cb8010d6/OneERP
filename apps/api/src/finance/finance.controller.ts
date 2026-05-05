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
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import {
  CreateInvoiceDto,
  CreatePaymentDto,
  PostInvoiceDto,
} from './dto/finance.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('财务管理 (Finance)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly financeDlqService: FinanceDlqService,
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

  @Get('dlq')
  @ApiOperation({ summary: '查看财务事件补偿队列' })
  async getDlq(@Query('limit') limit?: string) {
    return this.financeDlqService.list(Number(limit ?? 50));
  }

  @Post('dlq/retry')
  @ApiOperation({ summary: '重试财务事件补偿队列' })
  async retryDlq(@Body() body?: { limit?: number }) {
    return this.financeDlqService.retryPending(body?.limit ?? 20);
  }
}
