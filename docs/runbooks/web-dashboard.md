# Web Dashboard Runbook

## Scope

Use this runbook for dashboard shell work, business dashboard pages, navigation, dashboard data cards, dynamic model pages, and dashboard API wiring.

Primary files:

- `apps/web/src/app/dashboard/layout.tsx`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/dashboard/DashboardClient.tsx`
- `apps/web/src/app/dashboard/dynamic/[modelName]/page.tsx`
- `apps/web/src/app/dashboard/finance/`
- `apps/web/src/app/dashboard/inventory/`
- `apps/web/src/app/dashboard/orders/`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/core/`

Primary tests:

- `apps/web/src/__tests__/web-smoke.test.tsx`
- `apps/web/src/lib/__tests__/api.test.ts`
- `apps/web/src/components/core/__tests__/DynamicView.test.tsx`
- `apps/web/src/app/dashboard/orders/__tests__/OrderDetailPage.test.tsx`

## Read First

1. `docs/architecture/ARCHITECTURE.md`, sections "Metadata" and "Web"
2. `docs/architecture/STANDARDS.md`, core architecture constraints
3. Existing page, API helper, and dynamic view files related to the task

## Rules

- Reuse metadata-driven engines for standard CRUD views.
- Use `apps/web/src/lib/api.ts` for API access instead of ad hoc fetch wrappers.
- Keep business-specific presentation in dashboard pages; do not couple generic core components to one business model.
- Do not edit `apps/web/src/components/core/**` or `apps/web/src/lib/ui-schema.ts` unless the task explicitly owns that area.
- Match the compact ERP dashboard style and avoid marketing-page layouts inside operational screens.
- If a page depends on new API shape, align the API contract and tests before polishing UI states.

## Common Task Shape

1. Identify whether the screen is generic CRUD, dashboard aggregation, or document detail.
2. Use existing API helpers and metadata schema where possible.
3. Add loading, empty, error, and permission-aware states as needed.
4. Keep table, filter, and action behavior stable across mobile and desktop widths.
5. Test data mapping and page rendering.
6. Capture a browser check or screenshot when the task changes visible layout.

## Acceptance Commands

```bash
npm --prefix apps/web run test -- web-smoke
npm --prefix apps/web run test -- api
npm --prefix apps/web run test -- DynamicView
```

Run broader web checks when shared dashboard layout, API helpers, or core components change.
