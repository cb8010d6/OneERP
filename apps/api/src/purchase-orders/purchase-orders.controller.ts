import {
  Controller,
  Post,
  Get,
  Delete,
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
import { PurchaseOrdersService } from './purchase-orders.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { RequirePermissions } from '../core/decorators/require-permissions.decorator';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import {
  CreatePurchaseOrderDto,
  AddPurchaseOrderLineDto,
} from './dto/create-purchase-order.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('采购管理 (Purchase Orders)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) {}

  @Post()
  @ApiOperation({ summary: '创建采购单' })
  @RequirePermissions('purchase:write')
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.poService.createPurchaseOrder(companyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取采购单列表（支持分页和搜索）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  async findAll(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.poService.getPurchaseOrders(
      companyId,
      pagination,
      search,
      status,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取采购单详情' })
  async findOne(@Param('id') id: string, @CurrentCompany() companyId: string) {
    return this.poService.getPurchaseOrderById(id, companyId);
  }

  @Post(':id/lines')
  @ApiOperation({ summary: '向采购单添加行项（仅草稿状态）' })
  async addLine(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: AddPurchaseOrderLineDto,
  ) {
    return this.poService.addLine(id, companyId, user.id, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: '提交采购单审核 (DRAFT → SUBMITTED)' })
  @RequirePermissions('purchase:write')
  async submit(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.poService.submit(id, companyId, user.id);
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: '确认采购单 (SUBMITTED → APPROVED)，确认后可生成收货单',
  })
  @RequirePermissions('purchase:approve')
  async confirm(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.poService.confirm(id, companyId, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除草稿采购单' })
  @RequirePermissions('purchase:write')
  async remove(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.poService.delete(id, companyId, user.id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: '取消采购单 (DRAFT/SUBMITTED/APPROVED → CANCELLED)',
  })
  @RequirePermissions('purchase:cancel', 'purchase:write')
  async cancel(
    @Param('id') id: string,
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() body?: { reason?: string },
  ) {
    return this.poService.cancel(id, companyId, user.id, body?.reason);
  }
}
