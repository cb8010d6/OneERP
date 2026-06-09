import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Delete,
  Query,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { PermissionsGuard } from '../core/guards/permissions.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { RequirePermissions } from '../core/decorators/permissions.decorator';
import {
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderItemsDto,
} from './dto/create-order.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('订单管理 (Orders)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermissions('order:create')
  @ApiOperation({ summary: '创建新订单' })
  async createOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: CreateOrderDto,
  ) {
    // @ts-expect-error TODO(strict): DTO aiSummary Record<string, unknown> vs Prisma.InputJsonValue incompatibility
    return this.ordersService.createOrder(companyId, user.id, body);
  }

  @Get()
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '获取订单列表（支持分页和搜索）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getOrders(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.ordersService.getOrdersByCompany(
      companyId,
      pagination,
      search,
      status,
    );
  }

  @Get(':id')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '获取订单详情' })
  async getOrderById(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.getOrderById(orderId, companyId);
  }

  @Get(':id/timeline')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '获取订单时间线（审计与流转记录）' })
  async getOrderTimeline(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.getOrderTimeline(orderId, companyId);
  }

  @Get(':id/fulfillment-availability')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '获取订单交付可承诺分析' })
  async getOrderFulfillmentAvailability(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.getOrderFulfillmentAvailability(
      orderId,
      companyId,
    );
  }

  @Put(':id')
  @RequirePermissions('order:update')
  @ApiOperation({ summary: '更新订单头信息' })
  async updateOrder(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
    @Body() body: UpdateOrderDto,
  ) {
    return this.ordersService.updateOrder(companyId, orderId, body);
  }

  @Put(':id/items')
  @RequirePermissions('order:update')
  @ApiOperation({ summary: '更新订单明细并重新计算金额' })
  async updateOrderItems(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
    @Body() body: UpdateOrderItemsDto,
  ) {
    return this.ordersService.updateOrderItems(companyId, orderId, body);
  }

  @Delete(':id')
  @RequirePermissions('order:delete')
  @ApiOperation({ summary: '删除草稿订单' })
  async deleteOrder(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.deleteOrder(orderId, companyId);
  }
}
