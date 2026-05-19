import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext } from '../tenant/tenant-context';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const request = req as Request & { user?: { id?: string } };
    const companyHeader = req.headers['x-company-id'];
    const companyId = Array.isArray(companyHeader)
      ? companyHeader[0]
      : companyHeader;
    const resolvedCompanyId =
      typeof companyId === 'string' ? companyId : undefined;

    const bodyCompanyId = this.bodyCompanyId(req.body);
    if (
      this.isMutatingRequest(req.method) &&
      resolvedCompanyId &&
      bodyCompanyId &&
      bodyCompanyId !== resolvedCompanyId
    ) {
      res.status(403).json({
        statusCode: 403,
        message: '请求 companyId 与当前公司上下文不一致',
        error: 'Forbidden',
      });
      return;
    }

    const userId =
      typeof request.user === 'object' && request.user && 'id' in request.user
        ? String(request.user.id)
        : undefined;

    TenantContext.run(
      {
        companyId: resolvedCompanyId,
        userId,
      },
      () => next(),
    );
  }

  private isMutatingRequest(method: string) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  }

  private bodyCompanyId(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return undefined;
    }
    const value = (body as { companyId?: unknown }).companyId;
    return typeof value === 'string' ? value : undefined;
  }
}
