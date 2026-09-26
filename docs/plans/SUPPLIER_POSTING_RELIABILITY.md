# Supplier posting reliability — Issue 21

This change repairs new supplier payment and credit posting attempts. It is not a production-readiness declaration or a historical accounting repair.

## Transaction and delivery contract

- Read the document, tenant/supplier relationships and settlement amounts inside a Serializable transaction. Reject cancelled documents and invalid positive amounts; preserve existing already-posted replay responses.
- Update the document and payable status and insert its stable-key outbox event in that same transaction. Retry only Prisma P2034 conflicts, at most three attempts, with fresh reads and validation each time.
- Dispatch only the committed event. A dispatch failure cannot undo committed business state; the durable event remains available for retry.
- Supplier finance listeners propagate errors to EventQueueService rather than marking the original event successful and inserting a duplicate retry record. Nest listener error suppression is explicitly disabled for these two handlers.
- Supplier journal creation performs source deduplication inside the existing company advisory transaction lock. Other callers retain intentional repeated manual references. This does not claim exactly-once delivery for the global event queue.
- Credit settlement status includes posted payments. The existing credit amount cap and accounting policy are otherwise unchanged.

## Verification

- Independent reciprocal review: Astra xhigh posting/listener implementation reviewed by a second Astra xhigh agent; accounting deduplication reviewed by the posting implementer. Root reviewed the integration harness and scope.
- Focused purchase/listener/accounting tests: 76 passed, including real Nest EventEmitter registration with synthetic storage. These are not PostgreSQL evidence.
- `npm run test:integration` adds 16 PostgreSQL cases for rollback after outbox insertion, post-commit dispatch failures, delivery retry, simultaneous posting and over-allocation conflicts, tenant refusal, concurrent journal deduplication and permitted manual reference reuse.
- Database tests require `ONEERP_INTEGRATION_TEST=1` and an explicit loopback PostgreSQL database whose name ends in `_test`. Fixtures use synthetic UUID-scoped data and scoped cleanup. Do not run against business data.
- CI generates Prisma, migrates the disposable PostgreSQL service and runs integration tests. Security audit runs separately so it cannot hide regression results. The existing `validate` aggregate still fails unless both security and validation succeed.
- Local PostgreSQL is unavailable in this execution environment. The initial PR must report database execution as pending until its GitHub CI result is observed.

## Compatibility and residual risks

No schema migration, endpoint change, event-name change, or broad service extraction is introduced. Rollback restores the prior application behavior; it does not undo already committed business transactions.

Historical already-POSTED documents whose earlier event was lost are not automatically backfilled. Reconcile them with their existing journals and obtain a reviewed repair plan before replaying anything.

Global queue claim/lease behavior, unrelated finance listeners, accounting-period closure races, and generic-resource ownership remain separate work. Issue 28 tracks the latter. Source-level tests and this repair do not replace full procurement, inventory, financial, deployment and recovery acceptance gates.
