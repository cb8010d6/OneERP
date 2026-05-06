# Purchase and Receiving Runbook

## Scope

Use this runbook for purchase orders, supplier confirmation, goods receipts, partial receiving, over-receipt controls, supplier bills, and three-way matching.

Primary files:

- `apps/api/src/purchase/purchase.module.ts`
- `apps/api/src/purchase/purchase.service.ts`
- `apps/api/src/purchase-orders/purchase-orders.module.ts`
- `apps/api/src/purchase-orders/purchase-orders.service.ts`
- `apps/api/src/goods-receipts/goods-receipts.module.ts`
- `apps/api/src/goods-receipts/goods-receipts.service.ts`
- `apps/api/src/finance/vendor-bill.service.ts`
- `apps/api/src/finance/three-way-match.service.ts`
- `apps/web/src/app/dashboard/inventory/receiving/page.tsx`

## Read First

1. `docs/architecture/DOMAIN_FLOW.md`, section "Purchase Flow"
2. `docs/plans/CORE_MODULES_DEV_PLAN.md`, section "Purchase"
3. Existing purchase, goods receipt, inventory, and finance files related to the task

## Rules

- Purchase approval or lifecycle status must go through the workflow layer.
- Receiving must write inventory movement or transaction records; do not update stock quantities directly.
- Partial receiving must keep the purchase order, received quantities, and open quantities consistent.
- Three-way matching must compare purchase order, receipt, and supplier bill quantity, price, tax code, and currency where those fields exist.
- Payables must enter the finance module; purchase code must not directly alter accounting balances.
- Cross-module effects should use events or clearly bounded service hooks.

## Common Task Shape

1. Decide the document boundary: purchase order, goods receipt, supplier bill, or match result.
2. Verify the state transition and whether it is editable, approvable, receivable, or closed.
3. Validate inbound DTOs, especially line quantities and document references.
4. Post stock through inventory movement APIs or services.
5. Create or update finance drafts through finance services.
6. Test partial receipt, over-receipt rejection, idempotency, and mismatch reasons.

## Acceptance Commands

```bash
npm --prefix apps/api run test -- purchase
npm --prefix apps/api run test -- goods-receipts
npm --prefix apps/api run test -- three-way-match
```

Use end-to-end checks when the task crosses purchase, inventory, finance, and web pages.
