# Stock-event accounting identity — Issue 37

## Scope and pre-change analysis

This change is limited to stock-depletion accounting and its durable identity. It
does not redefine shipment, valuation, accounting-period, account-mapping, zero-cost
or reversal policy. No production migration, historical replay or backfill is part
of this work. Production readiness remains governed by `PRODUCTION_READINESS.md`,
`HA_LITE_RUNBOOK.md` and `GO_LIVE_CHECKLIST.md`.

`InventoryService` creates an immutable `InventoryTransaction` for each allocation
and queues `inventory.stock_depleted` with `stock_depleted:<transaction id>`.
Different allocations and partial shipments legitimately share
`SALE-SHIP-<order number>`. The former listener treated that display reference as an
idempotency key, suppressing later legitimate cost entries. It also caught failed
postings, re-enqueued them and returned success; the original queue row could become
`RESOLVED` and deduplicate the replacement failure away.

The supplier-posting fix established the reusable concurrency pattern: acquire the
company journal advisory transaction lock, inspect durable accounting state, and
create under that same lock. Stock movements need their own identity; changing
display references, numbering or adding opaque text to descriptions is not a safe
substitute for an explicit source field.

## Transaction, event, idempotency and rollback boundaries

- Validate the incoming company, movement ID and exact event key. Inside the existing
  company journal lock, load a company-owned positive OUTBOUND movement, verify its
  source location and company-owned or system-preset material, and reject a destination
  location or mismatched material, quantity or business reference.
- Read the company's persisted queue snapshots for that exact event/key. Each must
  match the movement; duplicate snapshots must agree on cost presence and value.
  Missing, malformed or conflicting snapshots fail closed. Incoming cost cannot
  override the saved cost. Movement quantity, reference and operator are authoritative.
- The saved `unitCost` remains authoritative even if master costs change before
  delivery. A legitimate legacy persisted event without `unitCost` retains the prior
  company moving-average, then material-price fallback. This is not a newly chosen
  valuation rule or a historical valuation repair. Current shipment producers must
  all use `queueStockDepletedInTransaction` to include the movement cost snapshot.
  Negative or non-finite selected costs are rejected for data review, never silently
  treated as zero-cost success.
- Check a durable source-linked journal under the lock. A valid replay returns that
  committed entry without another write or new-period validation. A fresh posting
  retains the current posting-date rule (`now`), period guard, COGS/INVENTORY mapping
  and active company-scoped posting-account checks.
- The journal, nested lines and nullable `inventoryTransactionId` receipt are written
  in one transaction. A fault after journal insertion rolls all of them back; retry
  can create exactly one journal. Existing period and mapping helpers accept an
  optional transaction client; stock posting passes it throughout, including default
  account/journal provisioning. Other callers keep their original default client.
  No root-client query runs while stock posting holds its transaction connection or
  advisory lock, avoiding pool self-starvation. For stock posting, provisioning also
  rolls back with failure; the choice of accounts and provisioning rules is unchanged.
- `@OnEvent(..., { suppressErrors: false })` logs and rethrows accounting failures.
  `EventQueueService` owns the original row's retry state. No replacement Finance DLQ
  row is created. A failure to resolve the queue after journal commit safely reuses
  the committed receipt on the next delivery.
- The existing zero-cost behavior remains no journal. A saved zero-cost snapshot
  does not fall back to a later positive master cost. This patch does not introduce
  zero-value journal entries or a separate zero-cost receipt policy.

## Additive schema and legacy boundary

Migration `20260926010000_stock_accounting_source` adds nullable
`JournalEntry.inventoryTransactionId`, a unique `(companyId,
inventoryTransactionId)` index and an `ON DELETE RESTRICT` foreign key to the immutable
movement. The existing globally unique movement ID is the FK target; company identity
is checked explicitly inside the posting transaction. This avoids a redundant
compound index on the movement table. The FK does not by itself enforce cross-company
equality, so dedicated service ownership checks remain required; generic lifecycle
writes remain prohibited. There is no cascading deletion of accounting history.

Existing journals remain NULL and are not attributed by inference. A source-null
legacy INV journal sharing the proposed business reference (including NULL reference)
is ambiguous: it may be the same movement or another allocation. Fresh automatic
posting refuses it and leaves the event pending/failed under the existing retry
limit for authorized reconciliation. No automated reassignment, replay of historical
RESOLVED rows, deletion, or backfill is supplied.

The column is additive, but **mixed old/new consumers are not accounting-safe**: an
old consumer can pass its reference check then insert a source-null journal after a
new consumer posts. An approved release must stop/drain all old stock-event consumers
before activating the new consumer and its normal queue processing. Apply the
migration before new code. Confirm all producers include the cost snapshot. Review
pending/failed events and legacy-reference ambiguities; do not bulk replay history.

For rollback, stop affected stock-event consumers and obtain accounting/operator
review before reverting application behavior. Retain the additive column, unique
index and populated receipts; do not drop them or resume an old consumer against
replayed events. Follow the existing backup/restore and release approval gates.

Inventory reversal currently does not establish a matching COGS reversal event rule.
That remains a separate business-policy question; no new rule is invented here.

## Verification

Focused unit tests cover source/key/value validation, the existing mapping and
valuation fallbacks, the company lock, receipt replay, legacy ambiguity, zero cost,
period/account failure and a real Nest event-listener queue failure/retry cycle.
The pre-existing supplier and manual-journal tests retain their behavior.

`apps/api/test/integration/stock-accounting.integration-spec.ts` runs through the
existing integration-test discovery. It uses only synthetic UUID-scoped fixtures,
the real Prisma client, real Nest listener registration and the existing fail-closed
disposable test-database opt-in. Cases cover shared references, actual concurrent
delivery and duplicate queue rows, journal-insert rollback, resolution-after-commit
failure, saved cost, conflicting snapshots, tenant/material/location boundaries,
legacy NULL receipts, periods, posting accounts, SQL uniqueness and source deletion
restriction. A one-connection-pool concurrent posting case detects accidental root
client calls from inside the held transaction; a real tenant-context case covers
authorized system-preset materials. Cleanup deletes only the synthetic tenants
created by the test.

At implementation time, local API typecheck, scoped ESLint, Prisma static validation,
73 focused tests and all 628 API tests (49 suites) passed. The 18-case PostgreSQL
suite is authored but **not executed locally**; its only authorized execution target
is the existing GitHub CI PostgreSQL 15 disposable test service. Exact-head CI evidence
must be recorded by the release owner before claiming those cases passed. No local
PostgreSQL, Docker, downloaded database binaries or production connection was used.

`graphify-out/graph.json` and the `graphify` executable are unavailable in this
workspace; graph navigation/update could not be run. Source inspection and the
repository architecture/risk documents were used instead. This is not a production
readiness declaration.
