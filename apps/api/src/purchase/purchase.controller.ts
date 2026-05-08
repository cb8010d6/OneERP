import {
  Controller,
  Get,
  Post,
  Put,
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
import { PurchaseService } from './purchase.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { PaginationDto } from '../core/dto/pagination.dto';
import {
  CreatePurchaseOrderDto,
  ReceivePurchaseItemDto,
  UpdatePurchaseOrderStatusDto,
  ScanReceiveDto,
} from './dto/purchase.dto';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('采购管理 (Purchase)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post('orders')
  @ApiOperation({ summary: '创建采购订单' })
  async createPurchaseOrder(
    @CurrentCompany() companyId: string,
    @Body() body: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(companyId, body);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取采购订单列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getPurchaseOrders(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.purchaseService.getPurchaseOrders(
      companyId,
      pagination,
      status,
      search,
    );
  }

  @Get('orders/pending')
  @ApiOperation({ summary: '获取待收货采购单列表' })
  async getPendingReceivableOrders(@CurrentCompany() companyId: string) {
    return this.purchaseService.getPendingReceivableOrders(companyId);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '获取采购订单详情' })
  async getPurchaseOrderById(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.purchaseService.getPurchaseOrderById(orderId, companyId);
  }

  @Put('orders/:id/status')
  @ApiOperation({ summary: '更新采购订单状态' })
  async updatePurchaseOrderStatus(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
    @Body() body: UpdatePurchaseOrderStatusDto,
  ) {
    return this.purchaseService.updatePurchaseOrderStatus(
      orderId,
      companyId,
      body,
    );
  }

  @Post('orders/receive')
  @ApiOperation({ summary: '采购收货执行' })
  async receivePurchaseItem(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: ReceivePurchaseItemDto,
  ) {
    return this.purchaseService.receivePurchaseItem(companyId, body, user.id);
  }

  @Post('orders/scan-receive')
  @ApiOperation({ summary: '扫码收货（自动匹配采购单）' })
  async scanReceive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: ScanReceiveDto,
  ) {
    return this.purchaseService.scanReceive(companyId, body, user.id);
  }
}
