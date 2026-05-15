export const PERMISSIONS_KEY = 'oneerp:permissions';
export const PERMISSIONS_ANY_KEY = 'oneerp:permissions:any';

export const Permission = {
  UserRead: 'user:read',
  UserCreate: 'user:create',
  UserUpdate: 'user:update',
  UserInvite: 'user:invite',
  UserResetPassword: 'user:reset-password',
  RoleRead: 'role:read',
  WorkflowTransition: 'workflow:transition',
  WorkflowTransitionAuto: 'workflow:transition:auto',
  DepartmentRead: 'department:read',
  DepartmentCreate: 'department:create',
  DepartmentUpdate: 'department:update',
  DepartmentDelete: 'department:delete',
  FileRecordRead: 'fileRecord:read',
  FileRecordCreate: 'fileRecord:create',
  InventoryRead: 'inventory:read',
  InventoryPost: 'inventory:post',
  FinanceRead: 'finance:read',
  FinancePost: 'finance:post',
  FinanceTrialBalanceRead: 'finance:trial-balance:read',
  AiRead: 'ai:read',
  AiWrite: 'ai:write',
  CrudAuto: 'crud:auto',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ROLE_TEMPLATES: Array<{
  name: string;
  permissions: string[];
}> = [
  { name: 'SuperAdmin', permissions: ['ALL'] },
  {
    name: 'Admin',
    permissions: [
      'user:*',
      'role:read',
      'partner:*',
      'order:*',
      'product:*',
      'material:*',
      'warehouse:*',
      'stockLocation:*',
      'inventory:*',
      'invoice:*',
      'finance:*',
      'department:*',
      'customFieldDefinition:*',
      'fileRecord:*',
      'workflow:transition',
      'ai:read',
    ],
  },
  {
    name: 'Sales',
    permissions: [
      'partner:read',
      'partner:create',
      'partner:update',
      'order:read',
      'order:create',
      'order:update',
      'product:read',
      'material:read',
      'fileRecord:read',
      'inventory:read',
      'invoice:read',
      'ai:read',
    ],
  },
  {
    name: 'Warehouse',
    permissions: [
      'inventory:read',
      'inventory:post',
      'warehouse:read',
      'stockLocation:read',
      'fileRecord:read',
      'material:read',
      'product:read',
      'order:read',
    ],
  },
  {
    name: 'Finance',
    permissions: [
      'finance:read',
      'finance:post',
      'invoice:read',
      'invoice:update',
      'order:read',
      'partner:read',
      'journalEntry:read',
      'journalEntryLine:read',
      'account:read',
      'taxCode:read',
      'fileRecord:read',
      'ai:read',
    ],
  },
  {
    name: 'Readonly',
    permissions: [
      '*:read',
      'inventory:read',
      'finance:read',
      'finance:trial-balance:read',
      'fileRecord:read',
      'ai:read',
    ],
  },
];

export function hasPermission(
  grantedPermissions: readonly string[] | undefined,
  requiredPermission: string,
) {
  const permissions = grantedPermissions ?? [];
  if (permissions.includes('ALL') || permissions.includes(requiredPermission)) {
    return true;
  }

  const parts = requiredPermission.split(':');
  const resource = parts[0];
  const action = parts[parts.length - 1];
  if (!resource || !action) return false;

  return (
    permissions.includes(`${resource}:*`) ||
    permissions.includes(`*:${action}`) ||
    permissions.includes('*:*')
  );
}
