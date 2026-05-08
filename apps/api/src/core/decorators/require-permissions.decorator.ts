import { SetMetadata } from '@nestjs/common';

/**
 * 权限点声明装饰器。
 * 用法：@RequirePermissions('purchase:write', 'purchase:cancel')
 * 表示当前端点需要用户拥有列出的所有权限点之一。
 *
 * 权限点命名约定: <module>:<action>
 * 例如: purchase:read, purchase:write, finance:post, finance:reverse
 */
export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
