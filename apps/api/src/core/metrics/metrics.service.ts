import { Injectable } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;
  private readonly httpRequestsTotal: Counter<string>;
  private readonly httpRequestDuration: Histogram<string>;
  private readonly activeConnections: Gauge<string>;

  constructor() {
    this.registry = new Registry();

    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.activeConnections = new Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
      registers: [this.registry],
    });
  }

  recordRequest(
    method: string,
    path: string,
    status: number,
    duration: number,
  ) {
    this.httpRequestsTotal.inc({ method, path, status: String(status) });
    this.httpRequestDuration.observe(
      { method, path, status: String(status) },
      duration / 1000,
    );
  }

  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  decrementActiveConnections() {
    this.activeConnections.dec();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
