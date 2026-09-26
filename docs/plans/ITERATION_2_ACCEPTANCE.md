# Iteration 2 — First-company setup and business acceptance

Status: onboarding implementation and local integrated validation complete; browser and business acceptance remain pending. This checklist distinguishes source/test evidence from an actual operator or deployed-API run. It is not a production-readiness declaration.

## Product scope (Issue 24)

Make the first stocked purchase and resale discoverable using existing pages and APIs. The dashboard presents an operator guide, not an automatic readiness score. There are no inferred completion checkmarks, percentages, new business defaults, schema migrations, or new endpoints.

The narrow API addition registers `stockLocation` metadata for the existing generic CRUD route. Only `name` and `code` are exposed, both required in the form. `StockLocation.companyId` is already tenant-scoped. `warehouseId` and `parentId` are deliberately absent; `usage=INTERNAL` and `isActive=true` remain database defaults. Existing material metadata now requires `category` and sorts by `name`, since Prisma Material has no `createdAt` field.

The guide does not claim to solve all generic-CRUD tenant constraints. Product-to-material scalar foreign-key ownership remains a separate known boundary to review; this iteration must not claim complete cross-company onboarding assurance.

## Smallest useful user journey

| Step | Existing destination | What the operator must do | Is it required for this path? |
| --- | --- | --- | --- |
| Check current company and responsible roles | Dashboard company selector / employee management | Confirm the intended company; have an authorized user perform each step | Yes |
| Prepare trading partners | `/dashboard/dynamic/partner` | Use an active supplier (`SUPPLIER` or `BOTH`) for purchasing and customer (`CUSTOMER` or `BOTH`) for selling | Yes |
| Prepare the stocked item | `/dashboard/dynamic/material` | Set SKU, name, category and an appropriate unit | Yes |
| Prepare receiving location | `/dashboard/dynamic/stockLocation` | Create a distinct name and code for the internal receiving/dispatch location | Yes for actual stock receipt; merely saving a purchase order is insufficient |
| Prepare the saleable product | `/dashboard/dynamic/product` | Set a positive selling price, enable the product, and map it to the stocked material | Positive price is required by order creation; material mapping is required for the stocked fulfillment path |
| Verify accounting and tax setup | `/dashboard/finance`; `/dashboard/dynamic/taxCode` only where authorized | Have the finance owner verify accounts/mappings and applicable tax settings before real posting | Business control, not a claim that all are hard API prerequisites |
| Purchase and receive | `/dashboard/purchase` | Create a purchase order and receive into the prepared location; verify stock increases | Supplies opening availability for this scenario |
| Sell and fulfill | `/dashboard/sales`, then selected order detail | Create the order; verify availability; use the supported shipment action | Completes stocked resale; invoice/payment acceptance is a separate continuation |

Warehouse grouping is optional: `StockLocation.warehouseId` is nullable. BOM and work orders are for manufacturing, not required to purchase and resell existing stock. An opening-stock adjustment is unnecessary if the first purchase receipt creates the stock used in this scenario; do not directly edit `StockQuant.quantity`.

`production-init.ts` already seeds starter accounts, journals and a tax code. Those seeds are not a statement that the defaults suit the business. `OrdersService.resolveTaxCode` also has an existing fallback tax behavior; the guide must not turn that fallback into a recommendation.

## Operator acceptance cases (not yet browser-verified)

- [ ] A company with no operational data sees a useful sequence and actionable links without an automatic “ready” claim.
- [ ] Actions use permissions of the current company. A read-only user sees a view action; a user lacking read access sees a request-for-help instruction instead of a dead link. Wildcard permissions match existing permission semantics.
- [ ] Switching company changes available actions and does not retain the previous company's guide state.
- [ ] The guide remains available when unrelated dashboard statistics fail; it does not reinterpret a failed request as empty business data.
- [ ] Every linked dynamic model has registered metadata. There are no unsupported warehouse/BOM/account links or company-info fields presented as a working accounting setup flow.
- [ ] A new location submits only the intended name/code fields and remains an active internal location using database defaults; no new relation input is exposed.
- [ ] Material creation requires category, and its initial list request no longer sorts by nonexistent `createdAt`.
- [ ] Ordinary empty lists retain their existing create/view behavior. API validation and permission failures remain visible through existing pages; guide text does not promise a successful transaction.

## Verification evidence

| Evidence | Status | Scope / limit |
| --- | --- | --- |
| API metadata tests: `npm --prefix apps/api run test -- --runInBand metadata.service.spec.ts` | PASS — 4 tests | Schema fields/default sort checked against generated Prisma metadata; location defaults/optional warehouse verified; no database transaction exercised |
| API typecheck and targeted lint | PASS | `npm --prefix apps/api run typecheck`; API-directory `npx eslint src/core/metadata/metadata.service.ts src/core/metadata/metadata.service.spec.ts` |
| Web guide tests / typecheck / lint | PASS — 5 focused tests | Implementation owner ran `OperatorGuide.test.tsx`, web typecheck and scoped ESLint. Tests cover company switching, permission wildcards, read-only/create-without-read behavior, absence of fake progress and availability after dashboard stats failure |
| Full repository validation | PASS — 634 tests | 2 script tests, 536 API tests, 96 Web tests; Prisma checks, typecheck, lint and production builds passed on the combined supplier-posting and guide changes |
| Independent source review | PASS for bounded onboarding scope | Permission/route integration reviewed; risk reviewer found no blocker in narrow location/material metadata changes |
| New-company browser walkthrough | Not run | No current iteration operator evidence yet |
| Controlled deployed-API acceptance | Not run | Historical July UAT does not verify this iteration |

## Next actual UAT sequence

1. In a controlled test company, start from the normal initializer and record the precise commit, API/Web URLs, company and tester. Use the guide to create the partners, material, location and mapped positive-price product without direct database writes.
2. Execute the purchase-order path through `/purchase/orders`: create, receive into the location, then validate quantity in the inventory ledger. Verify an over-receipt is rejected without additional stock. Continue to the supported payable bill/payment path only under the approved current semantics.
3. Create and ship a sales order from the same stocked material. Verify stock movement and insufficient-stock rejection. Use the supported reversal path to correct an intentional test mistake; retain original and reversal references.
4. Re-run `scripts/staff-permission-smoke.mjs` and applicable smoke checks using the test environment's authorized credentials. Do not put credentials in the report or command transcript.
5. Use `scripts/business-acceptance.mjs` as a supplemental inventory/accounting baseline. Its purchase step posts direct purchase inbound stock; it does **not** prove the PO → receipt → payable invoice → supplier payment journey.
6. When testing the optional presales path, `scripts/quote-lifecycle-acceptance.mjs` requires existing `--partner-id` and `--product-id`. Manufacturing uses the separate `scripts/production-report-acceptance.mjs`. These are distinct evidence, not mandatory dependencies of stocked resale.

Record observed results, document IDs, quantities, errors and any manual workarounds. Leave unchecked cases pending instead of interpreting a successful build or unit test as operator acceptance.
