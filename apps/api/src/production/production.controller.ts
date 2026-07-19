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
import { ProductionService } from './production.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import {
  CreatePurchaseOrderFromShortagesDto,
  CreateWorkOrderDto,
  CreateWorkReportDto,
  GenerateWorkOrdersFromOrderDto,
  ReverseWorkReportDto,
} from './dto/production.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';

@ApiTags('生产制造 (Production)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Post('orders')
  @RequirePermissions(Permission.ProductionPost)
  @ApiOperation({ summary: '创建生产工单' })
  async createWorkOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.productionService.createWorkOrder(companyId, dto, user.id);
  }

  @Post('orders/from-sales-order/:orderId')
  @RequirePermissions(Permission.ProductionPost)
  @ApiOperation({ summary: '按销售订单和默认 BOM 批量生成生产工单' })
  async generateWorkOrdersFromSalesOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('orderId') orderId: string,
    @Body() dto: GenerateWorkOrdersFromOrderDto,
  ) {
    return this.productionService.generateWorkOrdersFromSalesOrder(
      companyId,
      orderId,
      dto,
      user.id,
    );
  }

  @Get('orders')
  @RequirePermissions(Permission.ProductionRead)
  @ApiOperation({ summary: '获取生产工单列表' })
  async getWorkOrders(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.productionService.getWorkOrders(companyId, pagination);
  }

  @Get('material-availability')
  @RequirePermissions(Permission.ProductionRead)
  @ApiOperation({ summary: '获取未完成工单的物料可用性和短缺分析' })
  async getMaterialAvailability(@CurrentCompany() companyId: string) {
    return this.productionService.getMaterialAvailability(companyId);
  }

  @Post('material-availability/purchase-order')
  @RequirePermissions(Permission.ProductionRead, Permission.PurchaseCreate)
  @ApiOperation({ summary: '按当前生产物料短缺生成采购单' })
  async createPurchaseOrderFromShortages(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreatePurchaseOrderFromShortagesDto,
  ) {
    return this.productionService.createPurchaseOrderFromShortages(
      companyId,
      user.id,
      dto,
    );
  }

  @Post('orders/:id/report')
  @RequirePermissions(Permission.ProductionPost)
  @ApiOperation({ summary: '提交报工/产量' })
  async submitWorkReport(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') workOrderId: string,
    @Body() dto: CreateWorkReportDto,
  ) {
    return this.productionService.submitWorkReport(
      companyId,
      workOrderId,
      user.id,
      dto,
    );
  }

  @Post('reports/:id/reverse')
  @RequirePermissions(Permission.ProductionPost)
  @ApiOperation({ summary: '冲销生产报工及其库存流水' })
  reverseWorkReport(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') workReportId: string,
    @Body() dto: ReverseWorkReportDto,
  ) {
    return this.productionService.reverseWorkReport(
      companyId,
      workReportId,
      user.id,
      dto,
    );
  }
}
