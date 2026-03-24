import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    // user 对象由 JwtStrategy 中的 validate 函数附加到 request 上
    return request.user;
  },
);
