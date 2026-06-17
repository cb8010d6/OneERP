import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MetricsController } from './metrics.controller';

function createController(env?: Record<string, string>) {
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env };
  const metricsService = {
    getMetrics: jest.fn().mockResolvedValue('# HELP test metric\n'),
    getContentType: jest.fn().mockReturnValue('text/plain'),
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const controller = new MetricsController(
    metricsService as never,
    prisma as never,
  );
  process.env = originalEnv;
  return { controller, metricsService, prisma };
}

function mockRes() {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  } as unknown as import('express').Response;
}

describe('MetricsController', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('/metrics', () => {
    it('returns metrics when no token configured', async () => {
      const { controller, metricsService } = createController();
      const res = mockRes();
      await controller.getMetrics(res);
      expect(metricsService.getMetrics).toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith('# HELP test metric\n');
    });

    it('returns metrics when correct token provided', async () => {
      const { controller } = createController({ METRICS_TOKEN: 'secret123' });
      const res = mockRes();
      await controller.getMetrics(res, 'Bearer secret123');
      expect(res.send).toHaveBeenCalled();
    });

    it('throws ForbiddenException when wrong token provided', async () => {
      const { controller } = createController({ METRICS_TOKEN: 'secret123' });
      const res = mockRes();
      await expect(controller.getMetrics(res, 'Bearer wrong')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when token required but missing', async () => {
      const { controller } = createController({ METRICS_TOKEN: 'secret123' });
      const res = mockRes();
      await expect(controller.getMetrics(res)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when METRICS_ENABLED=false', async () => {
      const { controller } = createController({ METRICS_ENABLED: 'false' });
      const res = mockRes();
      await expect(controller.getMetrics(res)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('/ready', () => {
    it('returns ready when database is ok', async () => {
      const { controller, prisma } = createController();
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const result = await controller.getReadiness();
      expect(result.status).toBe('ready');
      expect(result.checks.database).toBe('ok');
    });

    it('throws 503 when database fails', async () => {
      const { controller, prisma } = createController();
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      await expect(controller.getReadiness()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
