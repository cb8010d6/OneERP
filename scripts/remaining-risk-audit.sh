#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="${REMAINING_RISK_AUDIT_REPORT:-remaining-risk-audit-report.json}"

cd "$ROOT_DIR"
node scripts/remaining-risk-audit.mjs --report "$REPORT"
