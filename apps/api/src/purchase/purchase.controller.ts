import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import type { JwtUserPayload } from '../core/http/request.types';
import { PurchaseService } from './purchase.service';
import {
  CreatePurchaseInvoiceDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase.dto';

@ApiTags('采购管理 (Purchase)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post('orders')
  @RequirePermissions(Permission.PurchaseCreate)
  @ApiOperation({ summary: '创建采购单' })
  async createPurchaseOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(companyId, user.id, dto);
  }

  @Get('orders')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取采购单列表' })
  async listPurchaseOrders(@CurrentCompany() companyId: string) {
    return this.purchaseService.listPurchaseOrders(companyId);
  }

  @Get('orders/:id')
  @RequirePermissions(Permission.PurchaseRead)
  @ApiOperation({ summary: '获取采购单详情' })
  async getPurchaseOrder(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
  ) {
    return this.purchaseService.getPurchaseOrder(companyId, id);
  }

  @Post('orders/:id/receive')
  @RequirePermissions(Permission.PurchaseReceive)
  @ApiOperation({ summary: '采购收货并触发库存入库' })
  async receivePurchaseOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseService.receivePurchaseOrder(
      companyId,
      user.id,
      id,
      dto,
    );
  }

  @Post('orders/:id/invoice')
  @RequirePermissions(Permission.PurchaseInvoice)
  @ApiOperation({ summary: '按采购单生成应付发票' })
  async createPurchaseInvoice(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.purchaseService.createPurchaseInvoice(companyId, id, dto);
  }
}
