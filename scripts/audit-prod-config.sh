#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
ENV_FILE="${ENV_FILE:-.env}"
FAILED=0
REPORT="$ROOT/prod-config-audit.json"

env_value() {
  key="$1"
  if [ -f "$ROOT/$ENV_FILE" ]; then
    grep -E "^$key=" "$ROOT/$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
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

[ "$(env_value INIT_ADMIN_PASSWORD)" = "admin" ] && finding P0 default-admin "Change the initial admin password"
[ "$(env_value INIT_ADMIN_EMAIL)" = "admin@oneerp.local" ] && finding P0 default-admin-email "Use a real admin email for production"

CORS="$(env_value CORS_ORIGINS)"
case "$CORS" in
  ""|*"*"*|*localhost*) finding P1 cors-origins "Use real trusted origins for production CORS_ORIGINS" ;;
esac

if [ -f "$ROOT/$COMPOSE_FILE" ]; then
  for port in 5432 6379 9000 9001; do
    if grep -Eq ":[[:space:]]*$port\"|$port:$port" "$ROOT/$COMPOSE_FILE"; then
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
