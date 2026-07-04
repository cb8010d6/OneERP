#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
ENV_FILE="${ENV_FILE:-.env}"
RESULTS="$ROOT/deploy-check-report.json"
FAILED=0

case "$ENV_FILE" in
  /*) ENV_PATH="$ENV_FILE" ;;
  *) ENV_PATH="$ROOT/$ENV_FILE" ;;
esac

case "$COMPOSE_FILE" in
  /*) COMPOSE_PATH="$COMPOSE_FILE" ;;
  *) COMPOSE_PATH="$ROOT/$COMPOSE_FILE" ;;
esac

env_value() {
  key="$1"
  default="$2"
  if [ -f "$ENV_PATH" ]; then
    value="$(grep -E "^$key=" "$ENV_PATH" | tail -n 1 | cut -d= -f2- || true)"
    [ "$value" != "" ] && printf '%s' "$value" && return
  fi
  printf '%s' "$default"
}

check() {
  name="$1"
  shift
  if "$@"; then
    echo "[PASS] $name"
  else
    echo "[FAIL] $name"
    FAILED=$((FAILED + 1))
  fi
}

strong_secret() {
  key="$1"
  value="$(env_value "$key" "")"
  [ "${#value}" -ge 16 ] && [ "${value#CHANGE_ME}" = "$value" ]
}

compose() {
  if [ -f "$ENV_PATH" ]; then
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose -f "$COMPOSE_PATH" "$@"
  fi
}

compose_services_healthy() {
  output="$(compose ps 2>&1)" || return 1
  [ "$output" != "" ] || return 1
  printf '%s\n' "$output" | grep -Eiq '(exited|unhealthy|restarting|dead)' && return 1
  return 0
}

API_PORT="$(env_value API_PORT 8000)"
WEB_PORT="$(env_value WEB_PORT 3000)"
if [ "${API_BASE_URL:-}" != "" ] && [ "${API_URL:-}" = "" ]; then
  API_URL="${API_BASE_URL%/}/health"
fi
if [ "${WEB_BASE_URL:-}" != "" ] && [ "${WEB_URL:-}" = "" ]; then
  WEB_URL="$WEB_BASE_URL"
fi
API_URL="${API_URL:-http://localhost:$API_PORT/api/health}"
WEB_URL="${WEB_URL:-http://localhost:$WEB_PORT/}"

cd "$ROOT"
check docker docker version
check compose-config compose config
check env-file test -f "$ENV_PATH"
check secret-POSTGRES_PASSWORD strong_secret POSTGRES_PASSWORD
check secret-JWT_SECRET strong_secret JWT_SECRET
check secret-MINIO_SECRET_KEY strong_secret MINIO_SECRET_KEY
check secret-INIT_ADMIN_PASSWORD strong_secret INIT_ADMIN_PASSWORD
check compose-ps compose_services_healthy
check api-health curl -fsS "$API_URL"
check web-root curl -fsS "$WEB_URL"

cat > "$RESULTS" <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "composeFile": "$COMPOSE_FILE",
  "apiUrl": "$API_URL",
  "webUrl": "$WEB_URL",
  "failed": $FAILED
}
EOF

[ "$FAILED" -eq 0 ]
