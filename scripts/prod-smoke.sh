#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-.env}"
RESULTS="$ROOT/prod-smoke-report.json"
FAILED=0

env_value() {
  key="$1"
  default="$2"
  if [ -f "$ROOT/$ENV_FILE" ]; then
    value="$(grep -E "^$key=" "$ROOT/$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true)"
    [ "$value" != "" ] && printf '%s' "$value" && return
  fi
  printf '%s' "$default"
}

check_get() {
  name="$1"
  url="$2"
  shift 2
  if curl -fsS "$@" "$url" >/dev/null; then
    echo "[PASS] $name - $url"
  else
    echo "[FAIL] $name - $url"
    FAILED=$((FAILED + 1))
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

API_PORT="$(env_value API_PORT 8000)"
WEB_PORT="$(env_value WEB_PORT 3000)"
API_BASE_URL="${API_BASE_URL:-http://localhost:$API_PORT/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:$WEB_PORT}"
API_BASE_URL="${API_BASE_URL%/}"
WEB_BASE_URL="${WEB_BASE_URL%/}"
EMAIL="${EMAIL:-$(env_value INIT_ADMIN_EMAIL "")}"
PASSWORD="${PASSWORD:-$(env_value INIT_ADMIN_PASSWORD "")}"

check_get api-health "$API_BASE_URL/health"
check_get web-login "$WEB_BASE_URL/login"
check_get web-dashboard "$WEB_BASE_URL/dashboard"

login_body="{\"email\":\"$(json_escape "$EMAIL")\",\"password\":\"$(json_escape "$PASSWORD")\"}"
login_response="$(curl -fsS -X POST "$API_BASE_URL/auth/login" -H "Content-Type: application/json" -d "$login_body" || true)"
TOKEN="$(printf '%s' "$login_response" | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
COMPANY_ID="$(printf '%s' "$login_response" | sed -n 's/.*"companies"[[:space:]]*:[[:space:]]*\[[^]]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ "$TOKEN" != "" ] && [ "$COMPANY_ID" != "" ]; then
  echo "[PASS] api-login - user=$EMAIL company=$COMPANY_ID"
else
  echo "[FAIL] api-login"
  FAILED=$((FAILED + 1))
fi

if [ "$TOKEN" != "" ] && [ "$COMPANY_ID" != "" ]; then
  AUTH_ARGS="-H Authorization: Bearer $TOKEN -H x-company-id: $COMPANY_ID"
  check_get api-dashboard-stats "$API_BASE_URL/dashboard/stats" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-orders "$API_BASE_URL/orders" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-metadata-order "$API_BASE_URL/v1/metadata/order" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-resource-order "$API_BASE_URL/v1/resource/order?page=1&limit=20&searchFields=orderNo%2Cstatus&include=%7B%22partner%22%3Atrue%2C%22taxCode%22%3Atrue%7D" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-inventory-ledger "$API_BASE_URL/inventory/realtime-ledger" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-metadata-invoice "$API_BASE_URL/v1/metadata/invoice" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
  check_get api-resource-invoice "$API_BASE_URL/v1/resource/invoice?page=1&limit=20&searchFields=invoiceNo%2Cstatus&include=%7B%22order%22%3Atrue%2C%22taxCode%22%3Atrue%7D" -H "Authorization: Bearer $TOKEN" -H "x-company-id: $COMPANY_ID"
fi

cat > "$RESULTS" <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "apiBaseUrl": "$API_BASE_URL",
  "webBaseUrl": "$WEB_BASE_URL",
  "envFile": "$ENV_FILE",
  "failed": $FAILED
}
EOF

[ "$FAILED" -eq 0 ]
