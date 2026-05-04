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
import { CurrentCompany } from '../core/decorators/current-company.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { CreateWorkOrderDto, CreateWorkReportDto } from './dto/production.dto';
import { PaginationDto } from '../core/dto/pagination.dto';
import type { JwtUserPayload } from '../core/http/request.types';

@ApiTags('生产制造 (Production)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Post('orders')
  @ApiOperation({ summary: '创建生产工单' })
  async createWorkOrder(
    @CurrentCompany() companyId: string,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.productionService.createWorkOrder(companyId, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取生产工单列表' })
  async getWorkOrders(
    @CurrentCompany() companyId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.productionService.getWorkOrders(companyId, pagination);
  }

  @Post('orders/:id/report')
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
}
