#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/restore.sh backups/YYYYMMDD-HHMMSS"
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_DIR="$(CDPATH= cd -- "$1" && pwd)"

if [ ! -f "$BACKUP_DIR/postgres.sql" ]; then
  echo "postgres.sql not found in $BACKUP_DIR"
  exit 1
fi

cd "$ROOT"
docker compose -f docker-compose.easy.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$BACKUP_DIR/postgres.sql"

if [ -f "$BACKUP_DIR/minio-data.tgz" ]; then
  docker compose -f docker-compose.easy.yml exec -T minio sh -c "cd /data && tar xzf -" < "$BACKUP_DIR/minio-data.tgz"
fi

echo "Restore complete."
