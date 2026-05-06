# API Finance Runbook

## Scope

Use this runbook for accounting, invoices, payments, tax codes, vendor bills, journal entries, three-way matching finance outputs, and finance DLQ behavior.

Primary files:

- `apps/api/src/finance/finance.module.ts`
- `apps/api/src/finance/finance.service.ts`
- `apps/api/src/finance/accounting.service.ts`
- `apps/api/src/finance/finance-bridge.listener.ts`
- `apps/api/src/finance/finance-dlq.service.ts`
- `apps/api/src/finance/vendor-bill.service.ts`
- `apps/api/src/finance/three-way-match.service.ts`
- `apps/api/src/finance/dto/`

Primary tests:

- `apps/api/src/finance/finance.service.spec.ts`
- `apps/api/src/finance/accounting.service.spec.ts`
- `apps/api/src/finance/finance.controller.spec.ts`
- `apps/api/src/finance/tax-code.controller.spec.ts`
- `apps/api/src/finance/three-way-match.service.spec.ts`

## Read First

1. `docs/architecture/DOMAIN_FLOW.md`, section "Finance Flow"
2. `docs/plans/CORE_MODULES_DEV_PLAN.md`, section "Finance"
3. Existing finance service and spec files related to the task

## Rules

- Do not update account balances directly. Create balanced `JournalEntry` and `JournalEntryLine` records.
- Reversals must create reversing entries; do not delete or mutate posted history.
- Posted entries must remain auditable and traceable to the source event or document.
- Tax behavior must use `TaxCode` resolution instead of hard-coded rates where a tax code is available.
- Failed cross-module posting should be recorded in DLQ with enough context for retry.
- Amount calculations must preserve decimal semantics and avoid floating-point drift in business rules.

## Common Task Shape

1. Identify the source document or event: invoice, stock depletion, vendor bill, or manual journal.
2. Confirm the expected accounting effect and accounts.
3. Add or update DTO validation for any API input.
4. Implement posting through the accounting service.
5. Add tests for balanced entries, invalid inputs, retry or reversal behavior, and idempotency.
6. Run the smallest relevant finance test, then broader checks if shared behavior changed.

## Acceptance Commands

```bash
npm --prefix apps/api run test -- finance
npm --prefix apps/api run test -- accounting
npm --prefix apps/api run test -- three-way-match
```

For docs-only finance changes, `git diff --check` is enough unless markdown tooling is added.
