#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${ENUM_DIRTY_DATA_SQL:-enum-dirty-data-scan.sql}"

cd "$ROOT_DIR"
node scripts/enum-dirty-data-sql.mjs --output "$OUTPUT"
