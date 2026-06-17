import {
  Controller,
  Get,
  Res,
  Headers,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { MetricsService } from './metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

interface ReadinessResult {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: {
    database: 'ok' | 'fail';
  };
}

@Controller()
export class MetricsController {
  private readonly enabled: boolean;
  private readonly token: string | undefined;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    this.enabled = process.env.METRICS_ENABLED !== 'false';
    this.token = process.env.METRICS_TOKEN || undefined;
  }

  @Get('metrics')
  @ApiExcludeEndpoint()
  async getMetrics(
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ) {
    if (!this.enabled) {
      throw new ForbiddenException('Metrics endpoint is disabled');
    }

    if (this.token) {
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      const bearer = match?.[1] ?? '';
      if (
        !bearer ||
        bearer.length !== this.token.length ||
        !timingSafeEqual(Buffer.from(bearer), Buffer.from(this.token))
      ) {
        throw new ForbiddenException('Invalid metrics token');
      }
    }

    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }

  @Get('ready')
  @ApiExcludeEndpoint()
  async getReadiness(): Promise<ReadinessResult> {
    const checks: ReadinessResult['checks'] = {
      database: 'fail',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      // database check failed
    }

    if (checks.database === 'fail') {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks,
      });
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
