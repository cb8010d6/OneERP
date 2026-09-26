# Order fulfillment evidence (read-only)

`GET /orders` rows and `GET /orders/:id/fulfillment-availability` expose the same
additive `fulfillmentEvidence` contract. Existing routes and permissions remain.
No migration, posting, reservation, status mutation or event publication occurs.

The authoritative assessment is `FULFILLED`, `ON_HAND_COVERAGE`,
`WORK_ORDER_COVERAGE`, `SHORTAGE` or `DATA_REVIEW`. Consumers must use this new
field, not the legacy `overallStatus`, `lines` or `fulfillmentSummary`. Those
compatibility fields still compare original per-row demand and may repeat shared
stock/work quantities; they are not remaining-demand or shipment evidence.

`materialDemandGroups` aggregate original order rows by current active product
material. Child `orderItemIds` and distinct `productIds` preserve traceability;
there is deliberately no invented per-item shipped quantity. Missing/inactive
products, unmapped products and foreign-company material mappings receive review
groups (company-less global materials are allowed). Each group exposes
nullable `materialName`, `materialSku`, and `materialUnit` for display alongside
the material ID. Metadata is exposed only for verified same-company/global
materials; foreign, unverified, and unmapped material metadata is null.
Quantitative fields are
`orderedQty`, `netShippedQty`, `remainingQty`, `onHandQty`, `openWorkOrderQty`,
`onHandGapQty`, `projectedGapQty`, `assessment`, and machine-readable `issues`.
All quantity fields are nullable: invalid source aggregates are null, and uncertain
shipment/remaining/gap evidence is null, never an implied zero.
Unknown material mappings also have null stock and work-order supply; a valid
mapped material with no stock or work-order records has known zero supply.
Quantities retain four decimal places. Empty orders are `DATA_REVIEW`, never fulfilled.

Net shipped is company-scoped exact `OUTBOUND SALE-SHIP-{orderNo}` less inbound
reversals. Exact/numeric-cycle reversal references are candidates, not ownership:
`ORD` cycle 2 collides textually with the first reversal of `ORD-2`. A company-scoped
posted SALES return document must link the reversal move ID to its source order ID.
Known other-order moves are excluded. Missing/conflicting ownership requires
review. Owned prefixed disambiguation references are accepted as well. Unmatched
historical material and negative/over-shipped net demand fail closed. A changed
historical mapping cannot safely be reallocated to current rows.

Internal active-location stock is counted once per material within each order.
Each pending/in-progress company-scoped work order contributes once as
`max(plannedQty - actualQty, 0)`, grouped by its product's current material.
Completed work orders contribute nothing. `stockBasis: UNRESERVED_SNAPSHOT`
means independent orders can each show coverage from the same stock; assessments
must not be summed into a global allocation. `workOrderBasis: UNFINISHED_NOT_ETA`
means unfinished production is not finished stock and makes no delivery-date promise.
Expected order dates are not evidence of achievable dates.

List loading uses a bounded batch of products, stock, ledger candidates and return
documents, not per-row queries. List and detail use the same pure builder. Reads
are observations, not a transactionally reserved snapshot; concurrent posting may
change a subsequent response. No production-readiness claim follows from these
read-model tests; posting, permissions and deployment gates remain separate.
