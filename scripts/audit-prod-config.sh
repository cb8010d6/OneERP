#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
ENV_FILE="${ENV_FILE:-.env}"
FAILED=0
REPORT="$ROOT/prod-config-audit.json"

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
  if [ -f "$ENV_PATH" ]; then
    grep -E "^$key=" "$ENV_PATH" | tail -n 1 | cut -d= -f2- || true
  fi
}

finding() {
  severity="$1"
  name="$2"
  detail="$3"
  echo "[$severity] $name - $detail"
  [ "$severity" = "P0" ] && FAILED=$((FAILED + 1))
}

for key in POSTGRES_PASSWORD JWT_SECRET MINIO_SECRET_KEY INIT_ADMIN_PASSWORD; do
  value="$(env_value "$key")"
  if [ "${#value}" -lt 16 ] || [ "${value#CHANGE_ME}" != "$value" ]; then
    finding P0 "weak-$key" "$key must be unique, non-placeholder, and at least 16 characters"
  fi
done

ADMIN_EMAIL="$(env_value INIT_ADMIN_EMAIL)"
case "$ADMIN_EMAIL" in
  ""|admin@oneerp.local|CHANGE_ME*) finding P0 default-admin-email "Use a real production INIT_ADMIN_EMAIL" ;;
esac

[ "$(env_value INIT_ADMIN_PASSWORD)" = "admin" ] && finding P0 default-admin-password "Change the initial admin password"

CORS="$(env_value CORS_ORIGINS)"
case "$CORS" in
  ""|*"*"*|*localhost*|*127.0.0.1*|*0.0.0.0*) finding P0 cors-origins "Use real trusted public Web origins for production CORS_ORIGINS" ;;
esac

[ "$(env_value AI_WRITE_ENABLED)" = "true" ] && finding P1 ai-write-enabled "AI write actions require completed staff permission acceptance and explicit approval"

if [ -f "$COMPOSE_PATH" ]; then
  for port in 5432 6379 9000 9001; do
    if grep -Eq "^[[:space:]]*-[[:space:]]*['\"]?[^#]*:$port(['\"]?[[:space:]]*(#.*)?)?$" "$COMPOSE_PATH"; then
      finding P0 "public-port-$port" "Do not expose DB/Redis/MinIO ports in production"
    fi
  done
fi

cat > "$REPORT" <<EOF
{
  "auditedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "composeFile": "$COMPOSE_FILE",
  "envFile": "$ENV_FILE",
  "p0Findings": $FAILED
}
EOF

[ "$FAILED" -eq 0 ]
