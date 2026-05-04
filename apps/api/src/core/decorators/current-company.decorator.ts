import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithAuth } from '../http/request.types';

export const CurrentCompany = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
    // 拦截器在验证通过后，会将公司 ID 附加至 request
    return request.companyId ?? '';
  },
);
