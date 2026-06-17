import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  describe('normalizePath', () => {
    it('replaces UUID with :id', () => {
      expect(
        MetricsService.normalizePath(
          '/api/orders/550e8400-e29b-41d4-a716-446655440000',
        ),
      ).toBe('/api/orders/:id');
    });

    it('replaces numeric id with :id', () => {
      expect(MetricsService.normalizePath('/api/users/12345')).toBe(
        '/api/users/:id',
      );
    });

    it('replaces 24-char hex id with :id', () => {
      expect(
        MetricsService.normalizePath('/api/items/507f1f77bcf86cd799439011'),
      ).toBe('/api/items/:id');
    });

    it('preserves static paths', () => {
      expect(MetricsService.normalizePath('/api/health')).toBe('/api/health');
    });

    it('handles multiple ids in path', () => {
      expect(MetricsService.normalizePath('/api/orders/123/items/456')).toBe(
        '/api/orders/:id/items/:id',
      );
    });

    it('preserves query-free paths', () => {
      expect(MetricsService.normalizePath('/api/metrics')).toBe('/api/metrics');
    });
  });
});
