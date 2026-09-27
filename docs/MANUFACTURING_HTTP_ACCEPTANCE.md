# Synthetic manufacturing HTTP acceptance

`node scripts/manufacturing-acceptance.mjs` exercises existing public HTTP APIs against a disposable initialized tenant. It does not seed business state through Prisma, modify existing products/orders, or bypass engineering release controls.

Required environment:

| Variable | Value |
| --- | --- |
| `MANUFACTURING_ACCEPTANCE` | `1` (explicit write opt-in) |
| `API_BASE_URL` | Explicit HTTP(S) loopback API URL; no credentials, query or fragment |
| `BUSINESS_ACCEPTANCE_COMPANY_NAME` | Exact initialized company name, starting with `OneERP Synthetic HTTP Journey ` |
| `BUSINESS_ACCEPTANCE_ADMIN_EMAIL` | Disposable tenant administrator |
| `BUSINESS_ACCEPTANCE_ADMIN_PASSWORD` | Disposable tenant administrator password |
| `MANUFACTURING_ACCEPTANCE_REPORT` | Optional JSON evidence file path (`--report` overrides) |
| `MANUFACTURING_HTTP_TIMEOUT_MS` | Optional per-request timeout, 250–120000 ms; default 15000 |

Use the existing CI `http-journey` API/PostgreSQL/Redis/MinIO services after migrations and seed. Run sequentially after stocked trade while its API process is still alive:

```bash
export MANUFACTURING_ACCEPTANCE=1
export MANUFACTURING_ACCEPTANCE_REPORT="$RUNNER_TEMP/manufacturing-acceptance-report.json"
node scripts/manufacturing-acceptance.mjs
```

Upload the JSON report with the existing always-run evidence step; do not upload API logs or environment files. Optional root package aliases are `test:http-manufacturing` for the command above and `test:manufacturing-acceptance` for `node --test scripts/manufacturing-acceptance.test.mjs`. No additional infrastructure is required.

The script creates unique `MFG-` master data, a draft sales order, a default single-level BOM requiring two components per finished unit, and eight component units through the existing inbound posting API. Three distinct temporary users exercise engineering design, review and approval against a synthetic uploaded PDF fixture; its checksum and released revision pin are checked. All created engineering users are disabled in a finally block, with every disable attempted and failures failing the run. The PDF is upload test data, not an actual manufacturing drawing.

The production path verifies:

1. Reporting from an empty component location returns HTTP 409 with no work report, stock movement or progress change.
2. Reporting two good units consumes four components, receives two finished units and completes the work order; exactly two new movements exist.
3. Exact report replay returns the original report/movement IDs; changed-payload replay returns 409 without changes.
4. Reversal creates two separate compensating movements, preserves original movement contents, restores eight components/zero finished units and returns the work order to `PENDING`.
5. Exact reversal replay returns the same reversal/movement IDs; changed reason returns 409 with stock, progress and all four movement snapshots unchanged.

Every checkpoint counts fixture inventory movements and work reports in addition to checking ledger totals. Evidence contains step outcomes, synthetic fixture IDs and the source revision, never passwords, access tokens, raw login responses or server error bodies. Errors fail the process. HTTP redirects are rejected and each request is time bounded. Reads of paginated resources are capped at 20 pages; transaction reads use the existing latest-100 API, appropriate for this sequential disposable job and fail closed if fixture movements are missing.

The explicit opt-in, company naming check and loopback requirement reduce accidental targeting; they cannot prove a loopback server is disposable. The operator/CI owns creating the isolated tenant and destroying its database and object storage after the job. Synthetic master data, orders, reports, movements and upload remain for inspection until that disposal. No destructive cleanup or non-loopback override is supplied. If setup cannot return a newly created user ID, the disposable environment teardown remains the cleanup boundary.

This is bounded functional evidence, not production readiness, costing/GL reconciliation, multi-level BOM coverage, concurrency coverage or a replacement for `PRODUCTION_READINESS.md`, `HA_LITE_RUNBOOK.md` and `GO_LIVE_CHECKLIST.md`. Reversal stops at the restored state; it does not remove the original audit history or initial component receipt. Unexpected API behavior fails without changing core business policies.

Local verification:

```bash
node --check scripts/manufacturing-acceptance.mjs
node --test scripts/manufacturing-acceptance.test.mjs
```

These local checks validate syntax and fail-closed configuration/login/upload behavior using mocked fetch. They are not real HTTP manufacturing evidence; the latter requires a passing JSON report from the disposable CI services. Graphify was unavailable and `graphify-out/graph.json` absent in the implementation worktree; no graph refresh is claimed.

## Fixture email normalization correction

PR #44 CI run `36288350341` reached successful login/master-data creation, then received HTTP 401 on its first synthetic engineering actor login; cleanup disabled that actor. Source inspection showed `UsersService.createUser` stores the submitted email unchanged and hashes the supplied password, while `AuthService.validateUser` lowercases the email before exact lookup. The uppercase `MFG-` fixture prefix therefore created an account the normalized login lookup could not find. Actor fixture emails are now lowercased before both creation and login. No password-reset workaround, auth bypass or business-service change is made. The regression test models case-preserving creation and normalized authentication, exercising actor setup with an uppercase/mixed-case fixture prefix. A new real CI run is still required to prove the remaining journey.

## Insufficient-component HTTP status correction

PR #44 CI run `36288627115` passed engineering release, actor cleanup and work-order creation, then failed because the script expected HTTP 400 for an empty component location. The real response was HTTP 409, consistent with `InventoryService.reserveSourceStock`: no candidate with sufficient quantity (or a failed conditional reserve) throws `ConflictException`. The fixture now requires exactly 409 and still verifies unchanged inventory, work reports and progress after rejection. Changed-payload report and reversal replays likewise remain exact 409 checks, matching their production-service `ConflictException` branches. No broad acceptance of arbitrary 4xx responses is introduced; a subsequent real CI report remains required for the downstream steps.
