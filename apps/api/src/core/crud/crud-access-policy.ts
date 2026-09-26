import { ForbiddenException } from '@nestjs/common';

interface ResourcePolicy {
  writable: boolean;
  owner: 'company' | { relation: string; model: string };
}

// This is an API boundary, not a list of models discovered from editable UI
// schemas. New resources need an explicit ownership and lifecycle review.
const RESOURCE_POLICIES = Object.fromEntries<ResourcePolicy>([
  ...[
    'partner',
    'material',
    'product',
    'productCategory',
    'warehouse',
    'stockLocation',
    'bom',
    'department',
    'taxCode',
    'account',
  ].map<[string, ResourcePolicy]>((name) => [
    name,
    { writable: true, owner: 'company' },
  ]),
  ...[
    'order',
    'purchaseOrder',
    'purchaseReceipt',
    'purchaseInvoice',
    'workOrder',
    'invoice',
    'fileRecord',
    'journal',
    'journalEntry',
    'inventoryTransaction',
    'inventoryReturnDocument',
  ].map<[string, ResourcePolicy]>((name) => [
    name,
    { writable: false, owner: 'company' },
  ]),
  ...[
    ['orderItem', 'order', 'Order'],
    ['purchaseOrderLine', 'purchaseOrder', 'PurchaseOrder'],
    ['purchaseReceiptLine', 'receipt', 'PurchaseReceipt'],
    ['stockQuant', 'location', 'StockLocation'],
    ['journalEntryLine', 'journalEntry', 'JournalEntry'],
    ['inventoryReturnLine', 'returnDocument', 'InventoryReturnDocument'],
    ['bomLine', 'bom', 'Bom'],
  ].map<[string, ResourcePolicy]>(([name, relation, model]) => [
    name,
    {
      writable: name === 'bomLine',
      owner: { relation, model },
    },
  ]),
]);

export function getResourcePolicy(modelName: string): ResourcePolicy {
  const name = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const policy = Object.prototype.hasOwnProperty.call(RESOURCE_POLICIES, name)
    ? RESOURCE_POLICIES[name]
    : undefined;
  if (!policy) throw new ForbiddenException('此资源请通过专用接口访问');
  return policy;
}

export function assertGenericModelAllowed(modelName: string): void {
  getResourcePolicy(modelName);
}

export function assertGenericWriteAllowed(modelName: string): void {
  if (!getResourcePolicy(modelName).writable)
    throw new ForbiddenException('此资源请通过专用业务接口维护');
}
