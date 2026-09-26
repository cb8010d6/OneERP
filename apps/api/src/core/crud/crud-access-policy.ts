import { ForbiddenException } from '@nestjs/common';

// These models are owned by dedicated APIs with their own permissions,
// projections and lifecycle checks. CRUD_AUTO must never expose them.
const DEDICATED_MODELS = new Set([
  'company',
  'user',
  'role',
  'userCompanyRole',
  'userInvitation',
  'aiProviderSetting',
  'auditLog',
  'eventDlq',
]);

export function assertGenericModelAllowed(modelName: string): void {
  const delegateName = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  if (DEDICATED_MODELS.has(delegateName)) {
    throw new ForbiddenException('此资源请通过专用接口访问');
  }
}
