#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_DIR="${1:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
PROJECT_NAME="${PROJECT_NAME:-oneerp_drill_$(date +%Y%m%d%H%M%S)}"
REPORT_PATH="${REPORT_PATH:-restore-drill-report.json}"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAILED=0
CHECKS=""

add_check() {
  name="$1"
  status="$2"
  detail="$3"
  echo "[$status] $name - $detail"
  [ "$status" = "failed" ] && FAILED=$((FAILED + 1))
  CHECKS="$CHECKS{\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"},"
}

env_value() {
  key="$1"
  default="$2"
  value="$(grep -E "^$key=" "$DRILL_ENV" | tail -n 1 | cut -d= -f2- || true)"
  [ "$value" != "" ] && printf '%s' "$value" || printf '%s' "$default"
}

set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^$key=" "$DRILL_ENV"; then
    sed -i.bak "s|^$key=.*|$key=$value|" "$DRILL_ENV"
    rm -f "$DRILL_ENV.bak"
  else
    echo "$key=$value" >> "$DRILL_ENV"
  fi
}

if [ "$BACKUP_DIR" = "" ]; then
  BACKUP_DIR="$(find "$ROOT/backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1 || true)"
fi
[ "$BACKUP_DIR" != "" ] || { echo "No backup directory found"; exit 1; }
BACKUP_DIR="$(CDPATH= cd -- "$BACKUP_DIR" && pwd)"
[ -f "$BACKUP_DIR/postgres.sql" ] || { echo "postgres.sql not found in $BACKUP_DIR"; exit 1; }

mkdir -p "$ROOT/.restore-drill"
DRILL_ENV="$ROOT/.restore-drill/$PROJECT_NAME.env"
if [ -f "$BACKUP_DIR/.env.copy" ]; then
  cp "$BACKUP_DIR/.env.copy" "$DRILL_ENV"
elif [ -f "$ROOT/.env" ]; then
  cp "$ROOT/.env" "$DRILL_ENV"
else
  echo "No .env.copy in backup and no root .env found"
  exit 1
fi
set_env_value API_PORT 18000
set_env_value WEB_PORT 13000
set_env_value CORS_ORIGINS http://localhost:13000

PGUSER="$(env_value POSTGRES_USER oneerp)"
PGDB="$(env_value POSTGRES_DB oneerp)"

cleanup() {
  if [ "${KEEP_PROJECT:-}" = "" ]; then
    docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT"
docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" up -d --build db redis minio migrate
add_check temp-stack passed "$PROJECT_NAME"

docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" exec -T db psql -U "$PGUSER" -d "$PGDB" < "$BACKUP_DIR/postgres.sql"
add_check postgres-restore passed "$BACKUP_DIR/postgres.sql"

if [ -f "$BACKUP_DIR/minio-data.tgz" ]; then
  docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" exec -T minio sh -c "cd /data && tar xzf -" < "$BACKUP_DIR/minio-data.tgz"
  add_check minio-restore passed "$BACKUP_DIR/minio-data.tgz"
else
  add_check minio-restore skipped "minio-data.tgz not found"
fi

scalar() {
  docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" exec -T db psql -U "$PGUSER" -d "$PGDB" -tAc "$1" | tr -d '[:space:]'
}

count="$(scalar 'select count(*) from "Company";')"
[ "$count" -gt 0 ] && add_check company passed "$count company row(s)" || add_check company failed "$count company row(s)"
count="$(scalar 'select count(*) from "User" where "isActive" = true;')"
[ "$count" -gt 0 ] && add_check admin-user passed "$count active user row(s)" || add_check admin-user failed "$count active user row(s)"
count="$(scalar 'select count(*) from "TaxCode" where "isDefault" = true and active = true;')"
[ "$count" -gt 0 ] && add_check default-tax-code passed "$count default tax code row(s)" || add_check default-tax-code failed "$count default tax code row(s)"
count="$(scalar "select count(*) from \"Journal\" where type = 'GENERAL' and \"isActive\" = true;")"
[ "$count" -gt 0 ] && add_check default-general-journal passed "$count general journal row(s)" || add_check default-general-journal failed "$count general journal row(s)"

docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" -f "$COMPOSE_FILE" up -d api
curl -fsS http://localhost:18000/api/health >/dev/null && add_check api-health passed http://localhost:18000/api/health || add_check api-health failed http://localhost:18000/api/health

EMAIL="$(env_value INIT_ADMIN_EMAIL '')"
PASSWORD="$(env_value INIT_ADMIN_PASSWORD '')"
if [ "$EMAIL" != "" ] && [ "$PASSWORD" != "" ]; then
  if curl -fsS -X POST http://localhost:18000/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null; then
    add_check admin-login passed "$EMAIL"
  else
    add_check admin-login failed "Login failed for $EMAIL"
  fi
else
  add_check admin-login skipped "INIT_ADMIN_EMAIL or INIT_ADMIN_PASSWORD missing"
fi

ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS="${CHECKS%,}"
cat > "$ROOT/$REPORT_PATH" <<EOF
{
  "startedAt": "$STARTED",
  "endedAt": "$ENDED",
  "backupDir": "$BACKUP_DIR",
  "projectName": "$PROJECT_NAME",
  "rpoTargetMinutes": 15,
  "rtoTargetMinutes": 60,
  "status": "$([ "$FAILED" -eq 0 ] && echo passed || echo failed)",
  "checks": [$CHECKS]
}
EOF

[ "$FAILED" -eq 0 ]
