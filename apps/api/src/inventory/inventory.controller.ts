import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import { Permission } from '../core/permissions/permissions';
import {
  CreateInboundDto,
  CreateStockMoveDto,
  PurchaseInboundPostingDto,
  ReversePurchaseInboundDto,
  ReverseSaleOrderShipmentDto,
  SaleOrderShipmentDto,
  ScanOutboundDto,
} from './dto/inventory.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('智能仓储 (Inventory)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取公司所有库存列表（支持分页）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getCompanyStocks(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.inventoryService.getCompanyStocks(companyId, pagination);
  }

  @Get('warehouses')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取公司仓库列表' })
  async getWarehouses(@CurrentCompany() companyId: string) {
    return this.inventoryService.getWarehouses(companyId);
  }

  @Get('locations')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取公司库位列表' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  async getLocations(
    @CurrentCompany() companyId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventoryService.getLocations(companyId, warehouseId);
  }

  @Get('materials')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取公司物料列表' })
  async getMaterials(@CurrentCompany() companyId: string) {
    return this.inventoryService.getMaterials(companyId);
  }

  @Get('replenishment-suggestions')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取库存补货建议（最小库存、在手与在途）' })
  async getReplenishmentSuggestions(@CurrentCompany() companyId: string) {
    return this.inventoryService.getReplenishmentSuggestions(companyId);
  }

  @Get('transactions')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取出入库流水记录' })
  async getTransactions(@CurrentCompany() companyId: string) {
    return this.inventoryService.getTransactions(companyId);
  }

  @Get('returns')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({ summary: '获取最近退货过账单据' })
  async getReturnDocuments(@CurrentCompany() companyId: string) {
    return this.inventoryService.getReturnDocuments(companyId);
  }

  @Get('realtime-ledger')
  @RequirePermissions(Permission.InventoryRead)
  @ApiOperation({
    summary: '实时库存台账 – 快照查询，支持树形钻取与低库存预警',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @ApiQuery({ name: 'lowOnly', required: false, type: Boolean })
  async getRealtimeLedger(
    @CurrentCompany() companyId: string,
    @Query()
    pagination: PaginationDto & {
      search?: string;
      warehouseId?: string;
      lowOnly?: string;
    },
  ) {
    return this.inventoryService.getRealtimeLedger(companyId, pagination);
  }

  @Post('inbound')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '新建入库单' })
  async createInbound(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() payload: CreateInboundDto,
  ) {
    return this.inventoryService.createInbound(companyId, payload, user.id);
  }

  @Post('move')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '创建库存流转（复式库存过账）' })
  async createStockMove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() payload: CreateStockMoveDto,
  ) {
    return this.inventoryService.createStockMove(companyId, payload, user.id);
  }

  @Post('scan')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '扫码申请出库（移动端或扫码枪）' })
  async handleScan(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() payload: ScanOutboundDto,
  ) {
    return this.inventoryService.scanAndCreateOutboundRequest(
      companyId,
      user.id,
      payload,
    );
  }

  @Post('approve/transaction/:transactionId')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({
    summary: '审批出库申请并扣减库存（兼容旧客户端，已废弃）',
    deprecated: true,
    description: '当前版本已改为过账即生效，此端点保留兼容，不执行库存扣减。',
  })
  async approveOutbound(
    @CurrentCompany() companyId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.inventoryService.approveAndDeductStock(
      companyId,
      transactionId,
    );
  }

  @Post('posting/sale-order/:orderId/ship')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '按销售订单自动过账并出库' })
  async postSaleOrderShipment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderId') orderId: string,
    @Body() payload: SaleOrderShipmentDto,
  ) {
    return this.inventoryService.postSaleOrderShipment(
      companyId,
      orderId,
      payload,
      user.id,
    );
  }

  @Post('posting/purchase/inbound')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '按采购单自动过账并入库' })
  async postPurchaseInbound(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() payload: PurchaseInboundPostingDto,
  ) {
    return this.inventoryService.postPurchaseInbound(
      companyId,
      payload,
      user.id,
    );
  }

  @Post('posting/sale-order/:orderId/reverse')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '按销售订单执行逆向冲销回库' })
  async reverseSaleOrderShipment(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderId') orderId: string,
    @Body() payload: ReverseSaleOrderShipmentDto,
  ) {
    return this.inventoryService.reverseSaleOrderShipment(
      companyId,
      orderId,
      payload,
      user.id,
    );
  }

  @Post('posting/purchase/:purchaseNo/reverse')
  @RequirePermissions(Permission.InventoryPost)
  @ApiOperation({ summary: '按采购单执行逆向冲销出库' })
  async reversePurchaseInbound(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Param('purchaseNo') purchaseNo: string,
    @Body() payload: ReversePurchaseInboundDto,
  ) {
    return this.inventoryService.reversePurchaseInbound(
      companyId,
      purchaseNo,
      payload,
      user.id,
    );
  }
}
