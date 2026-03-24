import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../core/guards/jwt-auth.guard';
import { TenantGuard } from '../core/guards/tenant.guard';
import { CurrentCompany } from '../core/decorators/current-company.decorator';

@ApiTags('控制台 (Dashboard)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: '获取控制台实时统计数据' })
  async getStats(@CurrentCompany() companyId: string) {
    return this.dashboardService.getStats(companyId);
  }

  @Get('chart-data')
  @ApiOperation({ summary: '获取迗7天订单和发票趋势图表数据' })
  async getChartData(@CurrentCompany() companyId: string) {
    return this.dashboardService.getChartData(companyId);
  }
}
