import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * 自定义限流守卫 —— 支持反向代理/负载均衡场景。
 *
 * 默认 ThrottlerGuard 只取 req.ip，若服务部署在 Nginx / SLB 之后，
 * 需要读取 X-Forwarded-For 或 X-Real-IP 才能拿到客户端真实 IP，
 * 否则所有请求都会被当作来自同一 IP，限流形同虚设。
 *
 * IP 优先级：X-Forwarded-For（取第一个） > X-Real-IP > req.ip
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string {
    const request = req as Request;

    // X-Forwarded-For 可能包含多个 IP（经过多级代理），取第一个即真实客户端 IP
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0].trim();
      return ip;
    }

    // 其次尝试 X-Real-IP（Nginx 常用配置）
    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // 兜底使用 Express 解析出的 IP
    return request.ip ?? 'unknown';
  }
}
