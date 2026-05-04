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

    const userId =
      typeof request.user === 'object' && request.user && 'id' in request.user
        ? String(request.user.id)
        : undefined;

    TenantContext.run(
      {
        companyId: typeof companyId === 'string' ? companyId : undefined,
        userId,
      },
      () => next(),
    );
  }
}
