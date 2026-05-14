#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=".env"
API_BASE_URL=""
EMAIL=""
PASSWORD=""
REPORT="staff-permission-smoke-report.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --api-base-url) API_BASE_URL="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

ARGS=("$ROOT_DIR/scripts/staff-permission-smoke.mjs" "--env-file" "$ENV_FILE" "--report" "$REPORT")
if [[ -n "$API_BASE_URL" ]]; then ARGS+=("--api-base-url" "$API_BASE_URL"); fi
if [[ -n "$EMAIL" ]]; then ARGS+=("--email" "$EMAIL"); fi
if [[ -n "$PASSWORD" ]]; then ARGS+=("--password" "$PASSWORD"); fi

cd "$ROOT_DIR"
node "${ARGS[@]}"
