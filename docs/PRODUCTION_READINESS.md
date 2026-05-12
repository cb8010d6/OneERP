# OneERP Production Readiness

This checklist defines the gate for real inventory and finance use.

## Current Decision

OneERP can be deployed for controlled internal pilot use after the quickstart
deployment passes. Real production use is allowed only after every P0 and P1
item below is checked and signed off by the owner.

## P0 Required Before Real Production

- [ ] `npm run validate` passes on the exact commit to deploy.
- [ ] `docker compose -f docker-compose.easy.yml up -d --build` succeeds on a clean server.
- [ ] `/api/health` returns `status: ok`.
- [ ] Admin login works and the default admin password is changed.
- [ ] `.env` secrets are unique and stored outside Git.
- [ ] PostgreSQL backup and restore have both been tested.
- [ ] MinIO backup and restore have both been tested.
- [ ] HTTPS is enabled for public or cross-office access.
- [ ] Database, Redis, and MinIO ports are not public.
- [ ] `CORS_ORIGINS` only lists trusted Web origins.
- [ ] GitHub Dependabot critical/high vulnerabilities are reviewed and either fixed or accepted with written reason.
- [ ] At least one full purchase receiving flow is tested with real-like data.
- [ ] At least one full sales shipment flow is tested with real-like data.
- [ ] At least one journal posting and reversal scenario is tested.
- [ ] Trial balance is balanced after the finance test scenario.
- [ ] Stock ledger equals expected physical quantity after receiving, transfer, and shipment scenarios.

## P1 Strongly Recommended

- [ ] Add off-server scheduled backups.
- [ ] Add log retention for API and Web containers.
- [ ] Add uptime monitoring for Web and `/api/health`.
- [ ] Add disk usage monitoring for PostgreSQL and MinIO volumes.
- [ ] Create named business roles instead of only using `SuperAdmin`.
- [ ] Review every permission point used by finance and inventory.
- [ ] Document opening balances before finance go-live.
- [ ] Import master data in this order: company, users, partners, accounts, tax codes, warehouses, locations, materials, products, opening stock.
- [ ] Freeze schema changes during pilot accounting periods.

## Inventory Acceptance Scenarios

Run these with real-like SKUs, batches, and locations:

- [ ] Purchase receipt increases stock through transaction records.
- [ ] Transfer decreases source location and increases destination location.
- [ ] Shipment rejects insufficient available stock.
- [ ] Shipment creates immutable inventory movement records.
- [ ] Manual stock quantity edits are not used for business corrections.
- [ ] Inventory report matches `StockQuant` and transaction history.

## Finance Acceptance Scenarios

Run these with real-like accounts and tax codes:

- [ ] Sales invoice posting creates balanced journal entries.
- [ ] Purchase invoice posting creates balanced journal entries.
- [ ] Reversal creates inverse journal entries instead of deleting history.
- [ ] Trial balance debit equals credit.
- [ ] Tax code changes do not rewrite posted historical entries.
- [ ] Finance DLQ retry is observed after a simulated event failure.

## Rollback Plan

Before go-live:

1. Take a backup with `scripts/backup.*`.
2. Record the deployed Git commit.
3. Record current Docker image IDs.
4. Practice restore on a separate machine.
5. Define who can approve rollback.

Rollback options:

- Application rollback: deploy the previous Git commit and rebuild containers.
- Data rollback: restore PostgreSQL and MinIO from a known-good backup.

## Known Gaps To Track

- Some money fields are still `Float` in the Prisma schema. Production finance should migrate critical money fields to Decimal before high-volume accounting.
- Single-machine deployment is simple but not highly available.
- No built-in scheduled off-site backup job is enabled by default.
- Frontend lint still has warnings; they do not block deployment but should be reduced before tightening CI.
- GitHub dependency vulnerability alerts require a dedicated dependency hardening pass.
