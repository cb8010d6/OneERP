import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUserPayload, RequestWithAuth } from '../http/request.types';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
    // user 对象由 JwtStrategy 中的 validate 函数附加到 request 上
    return request.user as JwtUserPayload;
  },
);
