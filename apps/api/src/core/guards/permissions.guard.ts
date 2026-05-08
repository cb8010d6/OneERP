import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { RequestWithAuth } from '../http/request.types';

/**
 * 权限守卫 —— 配合 @RequirePermissions() 装饰器使用。
 *
 * 工作原理:
 * 1. TenantGuard 已将当前用户的 role（含 permissions[]）绑定到 request.userRole。
 * 2. 本守卫读取 @RequirePermissions('xxx') 声明的权限点列表。
 * 3. 检查 request.userRole.permissions 是否包含声明的任一权限点。
 * 4. 特殊规则: ADMIN 角色自动获得所有权限（全局通过）。
 * 5. 若端点未使用 @RequirePermissions()，本守卫默认放行。
 *
 * 使用顺序: @UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      string[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    // 未声明 @RequirePermissions() 的端点，默认放行
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const role = request.userRole;

    if (!role) {
      this.logger.warn(
        `权限拒绝: 用户 ${request.user?.id} 无角色信息 (应先经过 TenantGuard)`,
      );
      throw new ForbiddenException('无角色信息，无法验证权限');
    }

    // ADMIN 角色自动全权限
    if (role.name === 'ADMIN') {
      return true;
    }

    const userPermissions: string[] =
      (role as unknown as { permissions?: string[] }).permissions ?? [];

    // 检查用户是否拥有所需权限的任一项
    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasPermission) {
      this.logger.warn(
        `权限拒绝: 用户 ${request.user?.id} 角色 ${role.name} 缺少权限 [${requiredPermissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        `权限不足，需要以下权限之一: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
