import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
  Permission,
  hasPermission,
} from '../permissions/permissions';
import type { RequestWithAuth } from '../http/request.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const anyRequired =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const permissions = request.userRole?.permissions ?? [];
    const requiredPermissions = required.flatMap((permission) =>
      permission === Permission.CrudAuto
        ? [this.resolveCrudPermission(request)]
        : [permission],
    );

    const allPassed = requiredPermissions.every((permission) => {
      if (permission === Permission.WorkflowTransitionAuto) {
        return this.canTransitionWorkflow(request, permissions);
      }
      return hasPermission(permissions, permission);
    });
    const anyPassed =
      anyRequired.length === 0 ||
      anyRequired.some((permission) => hasPermission(permissions, permission));

    if (allPassed && anyPassed) {
      return true;
    }

    throw new ForbiddenException('当前角色无权执行该操作');
  }

  private resolveCrudPermission(request: RequestWithAuth) {
    const modelName = String(request.params?.modelName ?? '').trim();
    const resource = modelName || 'resource';
    const method = request.method.toUpperCase();

    if (method === 'GET') return `${resource}:read`;
    if (method === 'POST') return `${resource}:create`;
    if (method === 'PUT' || method === 'PATCH') return `${resource}:update`;
    if (method === 'DELETE') return `${resource}:delete`;
    return `${resource}:read`;
  }

  private canTransitionWorkflow(
    request: RequestWithAuth,
    permissions: readonly string[],
  ) {
    if (hasPermission(permissions, Permission.WorkflowTransition)) {
      return true;
    }

    const modelName = String(request.params?.modelName ?? '').trim();
    return modelName === 'order' && hasPermission(permissions, 'order:update');
  }
}
