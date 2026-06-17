import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @ApiExcludeEndpoint()
  async getMetrics(@Res() res: Response) {
    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }

  @Get('ready')
  @ApiExcludeEndpoint()
  getReadiness() {
    return { status: 'ready', timestamp: new Date().toISOString() };
  }
}
