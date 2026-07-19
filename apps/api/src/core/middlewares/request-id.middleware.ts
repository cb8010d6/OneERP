import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  requestId?: string;
}

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const header = request.headers['x-request-id'] as string | undefined;
    const requestId =
      header && VALID_REQUEST_ID.test(header) ? header : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  }
}
