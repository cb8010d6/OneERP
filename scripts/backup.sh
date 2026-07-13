#!/usr/bin/env sh
set -eu
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
POLICY_FILE="${POLICY_FILE:-ops/backup-policy.example.json}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.easy.yml}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc}"

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
FINAL_TARGET="$BACKUP_ROOT/$STAMP"
TARGET="$BACKUP_ROOT/.incomplete-$STAMP"

mkdir -p "$TARGET"
cleanup_incomplete() {
  rm -rf "$TARGET"
}
trap cleanup_incomplete EXIT HUP INT TERM
cd "$ROOT"

docker compose -f "$COMPOSE_FILE" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' > "$TARGET/postgres.sql"
MINIO_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q minio)"
[ "$MINIO_CONTAINER" != "" ] || { echo "MinIO container is not running"; exit 1; }
docker run --rm --volumes-from "$MINIO_CONTAINER" "$BACKUP_HELPER_IMAGE" \
  tar czf - -C /data . > "$TARGET/minio-data.tgz"
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

mv "$TARGET" "$FINAL_TARGET"
trap - EXIT HUP INT TERM

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

if [ "$OFFSITE_DIR" != "" ]; then
  mkdir -p "$OFFSITE_DIR/$STAMP"
  cp -R "$FINAL_TARGET/." "$OFFSITE_DIR/$STAMP/"
  echo "Off-site backup copy written to $OFFSITE_DIR/$STAMP"
fi

echo "Backup written to $FINAL_TARGET"
