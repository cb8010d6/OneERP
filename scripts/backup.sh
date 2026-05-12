#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
POLICY_FILE="${POLICY_FILE:-ops/backup-policy.example.json}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.easy.yml}"

read_policy_value() {
  key="$1"
  default="$2"
  if [ -f "$ROOT/$POLICY_FILE" ]; then
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const v=p[process.argv[2]];process.stdout.write(v===undefined||v===null||v===''?process.argv[3]:String(v));" "$ROOT/$POLICY_FILE" "$key" "$default"
  else
    printf '%s' "$default"
  fi
}

BACKUP_DIR="${BACKUP_DIR:-$(read_policy_value backupDir backups)}"
RETENTION_DAYS="$(read_policy_value retentionDays 14)"
POSTGRES_INTERVAL="$(read_policy_value postgresIntervalMinutes 15)"
MINIO_INTERVAL="$(read_policy_value minioIntervalMinutes 60)"
OFFSITE_DIR="$(read_policy_value offsiteDir '')"
STAMP="$(date +%Y%m%d-%H%M%S)"
case "$BACKUP_DIR" in
  /*) BACKUP_ROOT="$BACKUP_DIR" ;;
  *) BACKUP_ROOT="$ROOT/$BACKUP_DIR" ;;
esac
TARGET="$BACKUP_ROOT/$STAMP"

mkdir -p "$TARGET"
cd "$ROOT"

docker compose -f "$COMPOSE_FILE" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > "$TARGET/postgres.sql"
docker compose -f "$COMPOSE_FILE" exec -T minio sh -c "cd /data && tar czf - ." > "$TARGET/minio-data.tgz"
[ -f .env ] && cp .env "$TARGET/.env.copy"
cat > "$TARGET/backup-manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "composeFile": "$COMPOSE_FILE",
  "postgresIntervalMinutes": $POSTGRES_INTERVAL,
  "minioIntervalMinutes": $MINIO_INTERVAL,
  "retentionDays": $RETENTION_DAYS,
  "files": ["postgres.sql", "minio-data.tgz", ".env.copy"]
}
EOF

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

if [ "$OFFSITE_DIR" != "" ]; then
  mkdir -p "$OFFSITE_DIR/$STAMP"
  cp -R "$TARGET/." "$OFFSITE_DIR/$STAMP/"
  echo "Off-site backup copy written to $OFFSITE_DIR/$STAMP"
fi

echo "Backup written to $TARGET"
