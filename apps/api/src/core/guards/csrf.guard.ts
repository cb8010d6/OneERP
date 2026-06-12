import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method;

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    const csrfCookie = req.cookies?.['csrf'] as string | undefined;
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException('CSRF 校验失败');
    }

    return true;
  }
}
