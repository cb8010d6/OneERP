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
import { VendorBillService } from './vendor-bill.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import {
  CreateVendorBillDto,
  RecordVendorBillPaymentDto,
} from './dto/vendor-bill.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';
import { ThreeWayMatchService } from './three-way-match.service';

@ApiTags('应付管理 (Vendor Bill)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('finance/vendor-bills')
export class VendorBillController {
  constructor(
    private readonly vendorBillService: VendorBillService,
    private readonly threeWayMatchService: ThreeWayMatchService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建采购发票（应付单）' })
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateVendorBillDto,
  ) {
    return this.vendorBillService.create(companyId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: '获取采购发票列表' })
  async findAll(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.vendorBillService.findAll(companyId, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取采购发票详情' })
  async findOne(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.vendorBillService.findOne(companyId, id);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: '确认应付单（草稿→待付）' })
  async confirm(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    return this.vendorBillService.confirm(companyId, id, user.id);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: '登记应付付款' })
  async recordPayment(
    @CurrentCompany() companyId: string,
    @Param('id') invoiceId: string,
    @Body() dto: RecordVendorBillPaymentDto,
  ) {
    return this.vendorBillService.recordPayment(companyId, invoiceId, dto);
  }

  @Post(':id/post')
  @ApiOperation({ summary: '过账采购发票（触发应付凭证生成）' })
  async post(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    return this.vendorBillService.post(companyId, id, user.id);
  }

  @Post(':id/match')
  @ApiOperation({ summary: '执行三单匹配校验 (PO↔GR↔Bill)' })
  async match(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    return this.threeWayMatchService.validateAndPersist(companyId, id, user.id);
  }
}
