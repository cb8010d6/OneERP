import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Delete,
  Query,
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
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { PaginationDto } from '../core/dto/pagination.dto';

interface CurrentUserPayload {
  id: string;
}

@ApiTags('订单管理 (Orders)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: '创建新订单' })
  async createOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(companyId, user.id, body);
  }

  @Get()
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
  @ApiOperation({ summary: '获取订单详情' })
  async getOrderById(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.getOrderById(orderId, companyId);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: '获取订单时间线（审计与流转记录）' })
  async getOrderTimeline(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.getOrderTimeline(orderId, companyId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除草稿订单' })
  async deleteOrder(
    @Param('id') orderId: string,
    @CurrentCompany() companyId: string,
  ) {
    return this.ordersService.deleteOrder(orderId, companyId);
  }
}
