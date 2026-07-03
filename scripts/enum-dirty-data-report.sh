#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="${ENUM_DIRTY_DATA_REPORT:-enum-dirty-data-report.json}"

cd "$ROOT_DIR"
node scripts/enum-dirty-data-report.mjs --report "$REPORT"
