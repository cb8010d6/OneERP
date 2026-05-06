# Module Runbooks

> Last updated: 2026-05-06
> Purpose: give each worker a short, stable handoff for module work without rereading the whole repository.

## Runbooks

| Runbook | Use When |
| --- | --- |
| [API Finance](api-finance.md) | Accounting, invoices, payments, tax codes, vendor bills, journal entries, and finance DLQ work |
| [Purchase and Receiving](purchase-receiving.md) | Purchase orders, goods receipts, supplier bills, and three-way matching |
| [Inventory](inventory.md) | Stock locations, quants, inventory transactions, stock ledger, and stock movement posting |
| [Web Dashboard](web-dashboard.md) | Dashboard shell, business dashboard pages, metadata-driven views, and web data access |
| [Multi-Agent Task Workflow](multi-agent-task-workflow.md) | Creating scoped task cards, branch handoff, validation, and PR readiness |

## Common Rules

- Start from `develop` and use one task branch per worker.
- Keep each PR inside one business boundary.
- Do not edit high-conflict files unless the task card explicitly assigns them.
- Database fields require Prisma schema, migration, DTO/service updates, and tests.
- Business status changes go through the workflow layer.
- Inventory changes go through movement or transaction records.
- Finance changes go through journal entries.
- Web UI should reuse metadata-driven engines and `apps/web/src/lib/api.ts`.

## Minimum Handoff

Every task should end with:

- Changed files.
- Validation commands and results.
- Schema or migration impact.
- Known risks, especially shared CI or integration failures outside the task scope.
