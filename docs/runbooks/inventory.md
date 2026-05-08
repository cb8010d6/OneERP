# Inventory Runbook

## Scope

Use this runbook for warehouses, stock locations, stock quants, inventory transactions, purchase inbound, sale outbound, transfers, ledger reporting, and stock warnings.

Primary files:

- `apps/api/src/inventory/inventory.module.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/api/src/inventory/inventory.controller.ts`
- `apps/api/src/inventory/dto/inventory.dto.ts`
- `apps/api/src/orders/order-workflow.listener.ts`
- `apps/api/src/finance/finance-bridge.listener.ts`
- `apps/web/src/app/dashboard/inventory/page.tsx`
- `apps/web/src/app/dashboard/inventory/receiving/page.tsx`

Primary tests:

- `apps/api/src/inventory/inventory.service.spec.ts`

## Read First

1. `docs/architecture/DOMAIN_FLOW.md`, sections "Inventory Flow" and cross-module flow
2. `docs/plans/CORE_MODULES_DEV_PLAN.md`, section "Inventory"
3. Existing inventory service and tests related to the task

## Rules

- Do not edit stock quantity directly from business modules.
- All stock changes must produce movement or transaction records.
- Outbound stock must fail when available stock is insufficient.
- Idempotent references are required for event-driven postings such as sale shipment or purchase inbound.
- Sale outbound may emit finance effects through stock depletion events.
- Purchase inbound should be traceable to the purchase document or receiving document.

## Common Task Shape

1. Identify the movement type: inbound, outbound, or transfer.
2. Define source and destination locations, batch behavior, and reference number.
3. Enforce stock availability and concurrency checks before outbound posting.
4. Persist both stock balance effects and transaction history.
5. Emit or verify downstream events when the move has finance or audit effects.
6. Test insufficient stock, duplicate reference, batch behavior, and ledger output.

## Acceptance Commands

```bash
npm --prefix apps/api run test -- inventory
npm --prefix apps/api run test -- orders
```

For dashboard-only inventory presentation changes, also run the relevant web test or web smoke test.
