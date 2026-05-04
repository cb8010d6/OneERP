import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithAuth } from '../http/request.types';

/**
 * 业务数据级防越权守卫。
 * 工作原理:
 * 1. 客户端发送请求时，必须在 Header 中携带 `x-company-id` 以声明要操作哪个公司。
 * 2. 守卫拦截请求，使用当前身份(JWT里的userId)检查 Prisma `UserCompanyRole` 表中有没有其权限。
 * 3. 如通过，将该公司ID和关联角色绑定在 Request 上，供后续操作使用。
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    const companyHeader = request.headers['x-company-id'];
    const companyId = Array.isArray(companyHeader)
      ? companyHeader[0]
      : companyHeader;

    if (!user) {
      throw new UnauthorizedException('尚未登录，无法访问租户数据');
    }

    if (!companyId) {
      throw new ForbiddenException(
        '请求格式错误: 缺少 x-company-id (必须指定当前试图操作的公司)',
      );
    }

    // 严密检查: 此人在请求的公司中是否有备案
    const userRole = await this.prisma.userCompanyRole.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: companyId,
        },
      },
      include: {
        role: true,
      },
    });

    if (!userRole) {
      throw new ForbiddenException(
        '非法操作: 您无权访问或操作该公司的任何数据',
      );
    }

    // 将通过鉴权的安全参数附在 request 上
    request.companyId = companyId;
    request.userRole = userRole.role;

    return true;
  }
}
