# Stocked purchase and resale — authenticated HTTP acceptance

This check exercises the application's HTTP API against a disposable test environment. It complements unit tests, database integration tests and the onboarding guide; it is not a browser test or a production deployment.

## Scope

Use the normal initializer to create one synthetic company and its administrator, then log in through the real authentication endpoint. Create operational master data through supported generic master-data endpoints. Create and receive the purchase order through the dedicated purchase API, then create, ship and reverse the sales order through their dedicated APIs.

No direct stock edits or direct purchase-inbound shortcut substitute for receiving the purchase order. No invoice, payment, year-end closing, manufacturing or new accounting policy is introduced.

## Journey and invariants

All routes below are relative to the configured `/api` base. Domain requests send the authenticated Bearer token and the selected company ID in `x-company-id`.

| Step | HTTP action | Required observation |
| --- | --- | --- |
| Authenticate | `POST /auth/login` | Token and a company membership are returned; credentials and token never enter the evidence report |
| Prepare master data | `POST /v1/resource/{partner,material,stockLocation,product}` | Active BOTH-role trading partner; material with SKU/name/category/unit; location with name/code; active stocked product mapped to material with positive selling price |
| Select explicit tax configuration | Read seeded active/default tax code | The order uses its ID; the test does not rely on the fallback tax rate or recommend the synthetic settings for a real business |
| Order goods | `POST /purchase/orders` | Quantity 10 and a returned purchase line ID; no stock created merely by ordering |
| First receipt | `POST /purchase/orders/:id/receive` | Receive 4 into the location/batch; received quantity and stock both equal 4; PO becomes `PARTIAL_RECEIVED` |
| Reject over-receipt | Same receipt route, request 7 more | Request fails; received quantity, receipt history and stock remain unchanged |
| Create sales order | `POST /orders` | Order quantity 6 for the mapped product; initial status `DRAFT` |
| Reject shortage shipment | `POST /inventory/posting/sale-order/:id/ship` | Atomic/default shipment of 6 fails while only 4 are on hand; stock and order status remain unchanged; no shipment movement appears |
| Finish receipt | Purchase receipt route, receive remaining 6 | PO becomes `RECEIVED`, received quantity 10, stock 10 |
| Ship | Sales shipment route, quantity 6 | Stock becomes 4; order becomes `SHIPPED`; one product line posts with traceable stock movement |
| Correct shipment | `POST /inventory/posting/sale-order/:id/reverse` | Stock returns to 10; a return document and reversal movement exist; original movement remains |
| Replay correction | Same reverse route again | Same return document ID, no new reversed lines or stock movement, stock remains 10 |

Current application behavior sets the order to `IN_PRODUCTION` after sales shipment reversal, including this stocked-resale scenario. The check records that existing behavior; it does not endorse or change the status policy.

Stock evidence comes from `/inventory/realtime-ledger`, matched by the created material and location, with transaction references checked through `/inventory/transactions`. The transaction endpoint is a recent-records view; a fresh synthetic database keeps the journey within that view. This check is not intended to scan an arbitrary existing tenant.

Every observed receipt, shipment and reversal movement must have a nonempty ID. The original shipment's ID, type, reference, material, quantity, source/destination locations and batch are captured at shipment and compared after reversal and replay; the reversal's same fields are compared after replay. Quantities are compared numerically so equivalent Decimal strings and JSON numbers agree, without rounding away a change.

## Disposable environment and execution safeguards

The intended runner is an independent CI job with PostgreSQL 15, Redis 7 and a job-local MinIO image built from the same pinned release's official source (details below). Run Prisma generation/migrations and the normal production initializer against the disposable database, build the API, start the actual API process, and wait for `/api/health` with a bounded deadline and child-process liveness check.

Required bootstrap configuration includes `DATABASE_URL`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` and `CORS_ORIGINS`. Test configuration also supplies the API port, Redis/MinIO connection settings, a unique synthetic company name, initializer credentials and `AI_WRITE_ENABLED=false`. No external AI provider is used.

The health endpoint reports process health rather than proving all backing services are available. Successful migration/initialization, dependency readiness and the subsequent HTTP journey provide separate evidence.

Execution must require explicit test opt-in and a loopback API URL. Do not load a production credential file by default. Use bounded HTTP requests and do not automatically retry writes: an ambiguous timeout must fail the run instead of risking a duplicate business transaction. Always stop the spawned API/container and retain useful, credential-free diagnostic output. Do not clean up by deleting arbitrary business rows; discard the isolated environment.

## Script contract

After the disposable API has been initialized and started, run `npm run test:http-journey`. The script requires all of:

- `STOCKED_TRADE_ACCEPTANCE=1`
- `API_BASE_URL`, restricted to HTTP(S) loopback hosts `localhost`, `127.0.0.1` or `[::1]`, with `/api` (or an empty path normalized to `/api`)
- `BUSINESS_ACCEPTANCE_ADMIN_EMAIL` and `BUSINESS_ACCEPTANCE_ADMIN_PASSWORD`, supplied from the synthetic initializer credentials
- `BUSINESS_ACCEPTANCE_COMPANY_NAME`, matched to exactly one returned login membership

Set `STOCKED_TRADE_ACCEPTANCE_REPORT` or pass `--report <path>` to persist the JSON report. Without either, the script prints console outcomes only. The destination directory must already exist. The CI job should retain this credential-free JSON report, not upload unredacted raw API logs.

`STOCKED_TRADE_HTTP_TIMEOUT_MS` optionally sets the per-request deadline (default 15000; accepted range 250–120000 milliseconds), including response-body consumption. HTTP redirects are rejected. `GITHUB_SHA` is recorded as the source revision in CI; outside CI, supply it explicitly for revision provenance or expect a null revision field. The script does not read a credential file or accept a remote target override.

## Evidence and interpretation

| Verification layer | Recorded result | What it establishes |
| --- | --- | --- |
| Source/endpoint and final implementation review | PASS for CI execution | Payloads and expected states match current DTOs/services; corrected health assertion, exact movement counts, per-receipt quantities, immutable shipment/reversal field comparisons and report provenance reviewed |
| Script focused tests | PASS — 16 tests including fixture subtests | `node --test scripts/stocked-trade-acceptance.test.mjs`: opt-in/required inputs, loopback URL restrictions, CLI/numeric validation, stalled-body deadline, HTTP-error redaction, movement IDs and immutable fields. The full CLI fixture accepts an unchanged baseline and rejects shipment/reversal tampering and missing movement IDs. Small local HTTP fixtures are not the OneERP application |
| Authenticated OneERP HTTP run | PASS — 13/13 steps at `df902be` | [CI run 36250668125](https://github.com/cb8010d6/OneERP/actions/runs/36250668125), job `108427969780`, built and verified the fixed-source MinIO image, started the actual API and passed every journey step. Sanitized report artifact `10909430130` was uploaded. Earlier registry-denied attempts did not execute business steps; no assertion or required gate was relaxed |
| Exact-head CI validation | PASS at `df902be` | The same run passed 716 regular tests (18 scripts, 602 API, 96 Web) and 33 PostgreSQL regressions, migrations, risk preflight, builds, security audit and the aggregate required check. The stacked UI branch has separate additional tests; this row records this exact commit only |
| Browser walkthrough | Not run | UI rendering, form usability and accessibility are outside this API check |
| Production UAT/deployment | Not run | This job neither deploys nor approves real inventory/financial use |

A successful report should identify the source revision, run time, selected synthetic company, each step outcome, relevant document IDs and quantity/state observations. Report HTTP status and sanitized diagnostics on failure, never request credentials, authorization headers or login/refresh payloads. A failed assertion or request must return a nonzero exit status and must not be described as passed acceptance.

The aggregate required CI check must continue requiring the independent security audit. HTTP acceptance passing does not waive a security failure or the existing production-readiness gates.

## CI-only MinIO source provenance

`scripts/ci/minio.Dockerfile` builds only the disposable HTTP job's MinIO server. Docker Hub and Quay MinIO image pulls were unavailable; this path does not retry them, use `minio/mc`, change registry credentials, push an image, or alter production Compose/deployment configuration.

- Official source: [minio/minio release tag](https://github.com/minio/minio/tree/RELEASE.2024-01-18T22-51-28Z), retained at `RELEASE.2024-01-18T22-51-28Z`.
- Verified tag peel: annotated tag `5a337e33b13b7a2195d10bd6d30173b6397bae61` points to full commit [`19387cafab76133c2e7642de4aac8c81b9f4f8c7`](https://github.com/minio/minio/commit/19387cafab76133c2e7642de4aac8c81b9f4f8c7). The Docker build independently checks that tag-to-commit mapping and detached HEAD, failing if it changes. This is a source identity check, not a claim of signature verification.
- Builder: official `golang:1.21.6-bookworm`, pinned to manifest-list digest `sha256:3efef61ff1d99c8a90845100e2a7e934b4a5d11b639075dc605ff53c141044fc`, with automatic Go toolchain switching disabled. This pins the release's Go compiler version and satisfies upstream `go.mod`'s `go 1.19` requirement. Build concurrency is capped at two to bound runner memory use.
- Build: upstream's `kqueue` tag, `CGO_ENABLED=0`, `-trimpath` and `buildscripts/gen-ldflags.go`, with the published release timestamp supplied explicitly. Go module checksum verification and read-only module resolution are required; `go.mod`/`go.sum` must remain unchanged. The binary's reported release and full commit are checked before the runtime image is produced.
- Runtime: scratch plus server binary, CA certificates, upstream LICENSE/NOTICE/CREDITS and writable temporary/data directories, running as an unprivileged numeric user. No client tool or shell is included. The server binds to runner loopback only, the existing bounded health check remains mandatory, and existing `always()` cleanup removes its container. The local image is not published.
- Execution budget: HTTP job timeout increases from 20 to 30 minutes to allow source compilation; no business assertion, dependency gate, security audit or aggregate required check is changed.

Local Docker/Go execution is unavailable in the editing environment. The exact-head GitHub CI run above supplies the actual image build, binary release/commit check, MinIO startup and authenticated business acceptance evidence. This synthetic CI result does not certify production security, operator/browser usability or restore readiness. Production image availability is tracked separately in [issue #35](https://github.com/cb8010d6/OneERP/issues/35); production Compose files remain unchanged.
