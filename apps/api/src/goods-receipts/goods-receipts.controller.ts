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
import { GoodsReceiptsService } from './goods-receipts.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  CreateGoodsReceiptDto,
  ConfirmGoodsReceiptDto,
  ReverseGoodsReceiptDto,
} from './dto/create-goods-receipt.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('收货单管理 (Goods Receipts)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly service: GoodsReceiptsService) {}

  @Post()
  @ApiOperation({ summary: '创建收货单（关联采购单）' })
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateGoodsReceiptDto,
  ) {
    return this.service.create(companyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取收货单列表（支持分页）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  async findAll(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(companyId, pagination, status);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取收货单详情' })
  async findOne(@Param('id') id: string, @CurrentCompany() companyId: string) {
    return this.service.findOne(id, companyId);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: '确认收货 → 触发库存入库（幂等）' })
  async confirm(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmGoodsReceiptDto,
  ) {
    return this.service.confirm(companyId, id, dto, user.id);
  }

  @Post(':id/reverse')
  @ApiOperation({ summary: '冲销收货单 → 生成反向库存流水（幂等）' })
  async reverse(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() dto: ReverseGoodsReceiptDto,
  ) {
    return this.service.reverse(companyId, id, dto, user.id);
  }
}
