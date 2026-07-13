#!/usr/bin/env sh
set -eu
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_DIR="${1:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
COMPOSE_OVERRIDE_FILE="${COMPOSE_OVERRIDE_FILE:-}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc}"
PROJECT_NAME="${PROJECT_NAME:-oneerp_drill_$(date +%Y%m%d%H%M%S)}"
REPORT_PATH="${REPORT_PATH:-restore-drill-report.json}"
DRILL_API_PORT="${DRILL_API_PORT:-18001}"
DRILL_WEB_PORT="${DRILL_WEB_PORT:-13001}"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_EPOCH="$(date +%s)"
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

random_hex() {
  bytes="$1"
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

compose() {
  if [ "$COMPOSE_OVERRIDE_FILE" != "" ]; then
    docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" \
      -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE_FILE" "$@"
  else
    docker compose -p "$PROJECT_NAME" --env-file "$DRILL_ENV" \
      -f "$COMPOSE_FILE" "$@"
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
set_env_value API_PORT "$DRILL_API_PORT"
set_env_value WEB_PORT "$DRILL_WEB_PORT"
set_env_value CORS_ORIGINS "http://localhost:$DRILL_WEB_PORT"
set_env_value POSTGRES_PASSWORD "$(random_hex 24)"
set_env_value JWT_SECRET "$(random_hex 32)"
set_env_value MINIO_ACCESS_KEY "drill$(random_hex 6)"
set_env_value MINIO_SECRET_KEY "$(random_hex 24)"

PGUSER="$(env_value POSTGRES_USER oneerp)"
PGDB="$(env_value POSTGRES_DB oneerp)"

cleanup() {
  if [ "${KEEP_PROJECT:-}" = "" ]; then
    compose down -v >/dev/null 2>&1 || true
    rm -f "$DRILL_ENV"
  fi
}
trap cleanup EXIT

cd "$ROOT"
compose up -d --build --wait --wait-timeout 120 db redis minio
add_check temp-stack passed "$PROJECT_NAME"

compose exec -T db psql -U "$PGUSER" -d "$PGDB" < "$BACKUP_DIR/postgres.sql"
add_check postgres-restore passed "$BACKUP_DIR/postgres.sql"

if [ -f "$BACKUP_DIR/minio-data.tgz" ]; then
  MINIO_CONTAINER="$(compose ps -q minio)"
  [ "$MINIO_CONTAINER" != "" ] || { echo "MinIO drill container is not running"; exit 1; }
  docker run --rm -i --volumes-from "$MINIO_CONTAINER" "$BACKUP_HELPER_IMAGE" \
    tar xzf - -C /data < "$BACKUP_DIR/minio-data.tgz"
  add_check minio-restore passed "$BACKUP_DIR/minio-data.tgz"
else
  add_check minio-restore skipped "minio-data.tgz not found"
fi

scalar() {
  compose exec -T db psql -U "$PGUSER" -d "$PGDB" -tAc "$1" | tr -d '[:space:]'
}

count="$(scalar 'select count(*) from "Company";')"
[ "$count" -gt 0 ] && add_check company passed "$count company row(s)" || add_check company failed "$count company row(s)"
count="$(scalar 'select count(*) from "User" where "isActive" = true;')"
[ "$count" -gt 0 ] && add_check admin-user passed "$count active user row(s)" || add_check admin-user failed "$count active user row(s)"
count="$(scalar 'select count(*) from "TaxCode" where "isDefault" = true and active = true;')"
[ "$count" -gt 0 ] && add_check default-tax-code passed "$count default tax code row(s)" || add_check default-tax-code failed "$count default tax code row(s)"
count="$(scalar "select count(*) from \"Journal\" where type = 'GENERAL' and \"isActive\" = true;")"
[ "$count" -gt 0 ] && add_check default-general-journal passed "$count general journal row(s)" || add_check default-general-journal failed "$count general journal row(s)"

compose up -d api
DRILL_API_URL="http://127.0.0.1:$DRILL_API_PORT/api"
wait_for_api() {
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if curl -fsS "$DRILL_API_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}
if wait_for_api; then
  add_check api-health passed "$DRILL_API_URL/health"
else
  add_check api-health failed "$DRILL_API_URL/health"
fi

EMAIL="$(env_value INIT_ADMIN_EMAIL '')"
PASSWORD="$(env_value INIT_ADMIN_PASSWORD '')"
if [ "$EMAIL" != "" ] && [ "$PASSWORD" != "" ]; then
  LOGIN_BODY="{\"email\":\"$(json_escape "$EMAIL")\",\"password\":\"$(json_escape "$PASSWORD")\"}"
  if curl -fsS -X POST "$DRILL_API_URL/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_BODY" >/dev/null; then
    add_check admin-login passed "$EMAIL"
  else
    add_check admin-login failed "Login failed for $EMAIL"
  fi
else
  add_check admin-login skipped "INIT_ADMIN_EMAIL or INIT_ADMIN_PASSWORD missing"
fi

BACKUP_EPOCH="$(stat -c %Y "$BACKUP_DIR/postgres.sql")"
RPO_AGE_MINUTES="$(( ($(date +%s) - BACKUP_EPOCH) / 60 ))"
if [ "$RPO_AGE_MINUTES" -le 15 ]; then
  add_check rpo-age passed "$RPO_AGE_MINUTES minute(s)"
else
  add_check rpo-age failed "$RPO_AGE_MINUTES minute(s)"
fi

DURATION_SECONDS="$(( $(date +%s) - START_EPOCH ))"
if [ "$DURATION_SECONDS" -le 3600 ]; then
  add_check rto-duration passed "$DURATION_SECONDS second(s)"
else
  add_check rto-duration failed "$DURATION_SECONDS second(s)"
fi

ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CHECKS="${CHECKS%,}"
cat > "$ROOT/$REPORT_PATH" <<EOF
{
  "startedAt": "$STARTED",
  "endedAt": "$ENDED",
  "backupDir": "$BACKUP_DIR",
  "projectName": "$PROJECT_NAME",
  "composeFile": "$COMPOSE_FILE",
  "composeOverrideFile": "$COMPOSE_OVERRIDE_FILE",
  "rpoTargetMinutes": 15,
  "rpoAgeMinutes": $RPO_AGE_MINUTES,
  "rtoTargetMinutes": 60,
  "durationSeconds": $DURATION_SECONDS,
  "status": "$([ "$FAILED" -eq 0 ] && echo passed || echo failed)",
  "checks": [$CHECKS]
}
EOF

[ "$FAILED" -eq 0 ]
