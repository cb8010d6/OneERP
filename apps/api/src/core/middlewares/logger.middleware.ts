import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { RequestWithId } from './request-id.middleware';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  constructor(private readonly metricsService: MetricsService) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const { ip, method } = request;
    const originalUrl = this.sanitizeUrl(request.originalUrl);
    const userAgent = request.get('user-agent') || '';
    const requestId = request.requestId || '';
    const startTime = Date.now();

    this.metricsService.incrementActiveConnections();

    response.on('finish', () => {
      const { statusCode } = response;
      const contentLength = response.get('content-length') || 0;
      const responseTime = Date.now() - startTime;

      this.metricsService.decrementActiveConnections();
      const route =
        (request as { route?: { path?: string } }).route?.path ||
        originalUrl.split('?')[0];
      this.metricsService.recordRequest(
        method,
        route,
        statusCode,
        responseTime,
      );

      const logData = {
        method,
        url: originalUrl,
        statusCode,
        contentLength: Number(contentLength),
        responseTime,
        userAgent,
        ip,
        requestId,
      };

      if (statusCode >= 500) {
        this.logger.error(JSON.stringify(logData));
      } else if (statusCode >= 400) {
        this.logger.warn(JSON.stringify(logData));
      } else {
        this.logger.log(JSON.stringify(logData));
      }
    });

    next();
  }

  private sanitizeUrl(url: string): string {
    try {
      const [path, query] = url.split('?');
      if (!query) return path;
      const params = new URLSearchParams(query);
      for (const key of params.keys()) {
        if (/token|password|secret|key|auth/i.test(key)) {
          params.set(key, '***');
        }
      }
      return `${path}?${params.toString()}`;
    } catch {
      return url.split('?')[0];
    }
  }
}
