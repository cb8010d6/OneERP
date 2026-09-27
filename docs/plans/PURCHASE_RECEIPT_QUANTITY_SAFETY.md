# Purchase receipt quantity safety

This repair keeps purchase receipt totals, order progress and inventory writes consistent. It does not authorize production use, change accounting policy or repair historical data.

## Failure and invariant

Previously `receivePurchaseOrder` read the order before its transaction. Each requested receipt row was compared separately with the same saved `receivedQty`, and every row then replaced that quantity using the same snapshot. An order line for 10 could accept two rows of 6 in one request: receipt and inventory increased by 12 while the order line showed only 6. Two overlapping receipt requests had the same stale-read problem.

For new receipts, the sum of requested quantities for each order line must not exceed that line's remaining ordered quantity. Its received quantity increases exactly once by that sum. Individual receipt and stock rows retain their original destination and batch: split receipts are supported, not silently merged or rejected.

## Transaction, event, retry and rollback boundaries

- Validate positive finite quantities representable by the existing `Decimal(18,4)` quantity columns. Normalize only floating-point representation noise within `2 * Number.EPSILON * max(1, abs(quantity))` to four decimals, including older clients computing `0.3 - 0.1`. Reject genuinely finer quantities (including `0.00005`) and values that would normalize to zero instead of letting PostgreSQL round separate rows differently from their sum. Use the same normalized quantities for receipt rows, order aggregation and stock posting; use decimal arithmetic without currency rounding.
- Read the company-owned order, current status and order lines inside the same Serializable transaction that validates remaining quantity and writes the receipt, receipt lines, order progress, stock movements, stock quants, ledger snapshots and material costs.
- Update each order line once with its cumulative requested quantity. Recompute order status from the persisted line quantities in that transaction.
- Retry only rolled-back Prisma P2034 conflicts or a P2002 specifically identifying the generated `receiptNo`, at most three attempts total. Each attempt obtains fresh database state and a new generated receipt number. Validation failures and unrelated database errors are not retried.
- Keep stock posting on `createStockMoveInTransaction`. This existing receipt path creates only INBOUND movements and has no stock-depletion or purchase-posting event; no new accounting event has been introduced. Future event additions must be queued in the receipt transaction and dispatched only after commit.
- The final response read is outside the transaction retry boundary. Failure there cannot cause the service to repeat committed writes.
- The API has no request idempotency key. Repeating a successful partial receipt remains a new receipt if sufficient quantity remains; a completed order rejects further receipts. After an ambiguous response, inspect the saved receipts before resubmission. This repair does not promise safe automatic client replay or infer duplicate business receipts.

A stock failure at any point rolls the entire receipt back, including already-written earlier split rows. Retrying a fully rolled-back request can then succeed without leaving duplicate receipt or stock rows.

## Verification and limits

The existing purchase unit suite passes with 67 cases, including 16 new split, precision, transaction retry and post-commit failure cases. API TypeScript validation and scoped ESLint pass.

`apps/api/test/integration/purchase-receipt.integration-spec.ts` adds 13 real PostgreSQL cases covering duplicate 6+6 rejection, valid 2+3 splits, four-decimal equality and legacy-client floating-point compatibility, concurrent 6-on-10 refusal, concurrent valid partial receipts, late stock-write rollback/retry, tenant and destination checks, and the existing replay/response-read contract. It uses the existing fail-closed `ONEERP_INTEGRATION_TEST=1` plus loopback `_test` database requirement and UUID-scoped synthetic cleanup. These cases are authored and typechecked here; execution is pending the exact-head GitHub CI disposable PostgreSQL service. No local or production database was used.

Existing inconsistent historical receipts or order quantities need authorized investigation; this patch does not rewrite them. The purchase matching read model still applies its existing currency rounding/tolerance to displayed quantities and is a separate follow-up. There is no schema migration, endpoint change, new idempotency contract, financial valuation change or backfill.

Graphify files and executable are unavailable in this workspace. Architecture, transaction-boundary documents and source inspection were used; no graph update is claimed. Production release remains subject to `PRODUCTION_READINESS.md`, `HA_LITE_RUNBOOK.md` and `GO_LIVE_CHECKLIST.md`.
