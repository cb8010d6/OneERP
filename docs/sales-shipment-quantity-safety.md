# Sales shipment quantity safety

Scope: `InventoryService.postSaleOrderShipment` and sales reversal safety. No new order-state prerequisite, financial rule, reservation system, schema migration, or manufacturing policy is introduced. DRAFT shipment remains supported. The existing facade and stock engine remain in place.

## Transaction and delivery boundary

- Repeated `productId` entries in one shipment payload are rejected before any write in either mode. Clients must sum quantities for repeated order rows into one requested product entry. Repeated rows in the order itself remain supported; their product demand is aggregated. The legacy workflow-event fallback now does that aggregation too.
- Default posting reads tenant order demand, product/material mappings, net historical shipments and stock allocations inside the same Serializable transaction that writes movements, cost/ledger snapshots, order status and outbox. A later line failure rolls everything back.
- `allowPartial=true` retains explicit per-line commit/skip behavior. Each line performs its own fresh Serializable read/validate/write transaction and updates order status in that transaction. A failed line cannot erase earlier committed lines. A final read-only snapshot supplies returned totals/status.
- Only Prisma `P2034` serialization/deadlock conflicts restart the entire rolled-back transaction, at most three attempts. Exhaustion is a conflict response (or a skipped partial line), not an unbounded retry. Validation, unknown errors and post-commit dispatch failures are not replayed.
- Both modes enqueue `inventory.stock_depleted` with movement-based idempotency keys inside their transaction and dispatch after commit. A dispatch interruption can return an error although stock committed; the durable outbox remains. It must not be reported as a skipped line or cause an automatic shipment retry.
- Quantity aggregation and allocation use four decimal places, matching inventory storage, not currency's two-place default. Stock is still checked and decremented when posting; this is not a reservation or a delivery promise.

## Material and reversal evidence

Inventory movements identify materials, not delivered products or order rows. Net quantities are therefore aggregated by material. The service never invents per-row `deliveredQty`.

Outbound evidence uses the exact tenant sales-shipment reference. A candidate inbound reversal is deducted only when its movement ID is linked by a tenant `SALES`, `POSTED` return document to this order's `sourceDocumentId`. Evidence owned by a different order is ignored; missing/conflicting ownership is rejected for manual review. A string prefix, including a numeric suffix, does not establish ownership: order `ORD` and order `ORD-2` can otherwise collide.

On a new reversal, an occupied normal reference uses `SALE-SHIP-REV-{orderNo}-{orderId}-{cycle}` instead. An occupied fallback is rejected, never upserted over another return. Product and reversal material references must be owned by the tenant or be an approved global material (`companyId=null`). Malformed historical foreign references cannot create new stock/cost entries.

## Shared-material compatibility boundary

| Case | Behavior |
| --- | --- |
| One distinct product mapped to a material, including repeated order rows | Normal atomic or partial shipment against its aggregated remaining demand |
| Several order products share one material, net shipped is zero, complete group quantities requested with default atomic mode | Allowed; each product's original ordered quantity is required and physical stock is counted/decremented once |
| Shared-material group has partially shipped legacy quantities | Rejected: the ledger cannot establish which product remains |
| Shared-material group requested in `allowPartial` mode or incompletely in atomic mode | Rejected/skipped for that group; independent partial lines may still commit |
| Shared-material group already fully shipped | Further shipment rejected; genuine full reversal followed by atomic full-group reshipment remains supported |

Operators should inspect the order, product mappings, actual goods movement and return evidence. Only shipments genuinely needing correction may use the existing reversal workflow, after which a zero-net shared group can be submitted atomically. **Do not create a fictitious return to bypass validation.** Legitimate partially delivered shared-material orders need controlled reconciliation and future original-outbound/product identity support; this patch does not pretend they can always continue automatically. Missing or changed mappings and negative/over-demand historical net quantities also require review.

## Reversal time ambiguity

Sales reversal still uses the existing last-return timestamp cycle boundary. Its order read and all writes now share Serializable retry protection. Selected candidate quantities must exactly reconcile **per material** with all-time net delivery (exact outbound minus owned return movements), including the no-candidate/replay path. This calculation is independent of current product mapping or order-demand caps, so a genuine historical over-shipment can still be corrected. A return transaction can start before a shipment it later observes; PostgreSQL transaction-start timestamps alone therefore cannot prove that a later timestamp means an unreturned move.

If an outbound timestamp equals the latest return's millisecond timestamp, or selected quantities do not reconcile, the service returns an explicit validation error without changes rather than guessing which movement was reversed. This conservative boundary can reject some otherwise legitimate legacy replay/cycle cases. It is not a claim that every historical reversal is unaffected. Long-term resolution requires an immutable original outbound-movement association, not fabricated row attribution or rewritten timestamps.

Per-material reconciliation proves the quantity cap, not the identity of the original source-location/batch movement. Historical source/batch attribution cannot be reconstructed reliably from the current return-line schema and remains outside this patch.

## Regression evidence

`apps/api/test/integration/sales-shipment.integration-spec.ts` joins the existing `test/jest-integration.json` harness. It requires explicit `ONEERP_INTEGRATION_TEST=1` and a loopback disposable `_test` PostgreSQL database, creates synthetic UUID-scoped fixtures, and deletes only those fixtures. Barriers after transaction ledger reads force overlapping posting snapshots (including partial writes). Tests cover duplicate payloads, repeated order rows, default/partial concurrent caps, distinct-material concurrent status, four-place quantities, partial successes, rollback/outbox failures, dispatch interruption, shared groups, tenant/global ownership, reversal-reference collisions, unowned legacy reversals, shipment/reversal concurrency, repeated reversal and equal-millisecond fail-closed behavior.

Local typechecking/unit tests do not prove PostgreSQL behavior. This environment has no approved local PostgreSQL runtime; real database execution is delegated to the existing GitHub Actions PostgreSQL 15 validation job. Record its exact commit/run and result before claiming these regressions passed. The earlier stocked-trade 13-step HTTP journey is separate evidence and must remain required.

Local implementation checks: API typecheck, build and complete lint passed; 49 unit-test suites / 607 tests passed. The 26 PostgreSQL regression cases are authored and typechecked, not locally executed. `git diff --check` passed. `graphify update .` was attempted but unavailable because this environment does not have the `graphify` command; no graph update is claimed.
