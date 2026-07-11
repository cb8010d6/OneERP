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
  RequirementRead: 'requirement:read',
  RequirementCreate: 'requirement:create',
  RequirementUpdate: 'requirement:update',
  RequirementFollowUp: 'requirement:follow-up',
  QuoteRead: 'quote:read',
  QuoteCreate: 'quote:create',
  QuoteUpdate: 'quote:update',
  QuoteSend: 'quote:send',
  QuoteRecordDecision: 'quote:record-decision',
  ContractRead: 'contract:read',
  ContractCreate: 'contract:create',
  ContractUpdate: 'contract:update',
  ContractSubmit: 'contract:submit',
  ContractApproveSales: 'contract:approve-sales',
  ContractReviewFinance: 'contract:review-finance',
  ContractReviewBusiness: 'contract:review-business',
  InventoryRead: 'inventory:read',
  InventoryPost: 'inventory:post',
  PurchaseRead: 'purchase:read',
  PurchaseCreate: 'purchase:create',
  PurchaseReceive: 'purchase:receive',
  PurchaseInvoice: 'purchase:invoice',
  FinanceRead: 'finance:read',
  FinancePost: 'finance:post',
  FinanceTrialBalanceRead: 'finance:trial-balance:read',
  ProductionRead: 'production:read',
  ProductionPost: 'production:post',
  AiRead: 'ai:read',
  AiWrite: 'ai:write',
  AiSettingsUpdate: 'ai:settings:update',
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
      'purchase:*',
      'purchaseOrder:*',
      'purchaseReceipt:*',
      'purchaseInvoice:*',
      'invoice:*',
      'finance:*',
      'production:*',
      'department:*',
      'customFieldDefinition:*',
      'fileRecord:*',
      'requirement:*',
      'quote:*',
      'contract:*',
      'workflow:transition',
      'ai:read',
      'ai:settings:update',
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
      'requirement:read',
      'requirement:create',
      'requirement:update',
      'requirement:follow-up',
      'quote:read',
      'quote:create',
      'quote:update',
      'quote:send',
      'quote:record-decision',
      'contract:read',
      'contract:create',
      'contract:update',
      'contract:submit',
      'purchase:read',
      'purchaseOrder:read',
      'inventory:read',
      'production:read',
      'invoice:read',
      'ai:read',
    ],
  },
  {
    name: 'SalesManager',
    permissions: [
      'partner:read',
      'order:*',
      'product:read',
      'material:read',
      'requirement:*',
      'quote:*',
      'contract:read',
      'contract:update',
      'contract:submit',
      'contract:approve-sales',
      'inventory:read',
      'finance:read',
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
      'purchase:read',
      'purchase:receive',
      'purchaseOrder:read',
      'purchaseReceipt:read',
      'production:read',
      'production:post',
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
      'purchase:read',
      'purchase:invoice',
      'purchaseOrder:read',
      'purchaseReceipt:read',
      'purchaseInvoice:read',
      'purchaseInvoice:update',
      'journalEntry:read',
      'journalEntryLine:read',
      'account:read',
      'taxCode:read',
      'fileRecord:read',
      'purchase:read',
      'contract:read',
      'contract:review-finance',
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
      'production:read',
      'fileRecord:read',
      'ai:read',
    ],
  },
  {
    name: 'BusinessReview',
    permissions: [
      'partner:read',
      'order:read',
      'requirement:read',
      'quote:read',
      'contract:read',
      'contract:review-business',
      'finance:read',
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
