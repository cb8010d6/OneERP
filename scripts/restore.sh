#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/restore.sh backups/YYYYMMDD-HHMMSS"
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BACKUP_DIR="$(CDPATH= cd -- "$1" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.easy.yml}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc}"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

if [ ! -f "$BACKUP_DIR/postgres.sql" ]; then
  echo "postgres.sql not found in $BACKUP_DIR"
  exit 1
fi

cd "$ROOT"
# Check helper availability and archive readability before changing PostgreSQL.
if [ -f "$BACKUP_DIR/minio-data.tgz" ]; then
  MINIO_CONTAINER="$(compose ps -q minio)"
  case "$MINIO_CONTAINER" in
    ""|*[!a-zA-Z0-9_-]*) echo "Expected one running MinIO container"; exit 1 ;;
  esac
  docker run --rm -i "$BACKUP_HELPER_IMAGE" tar tzf - < "$BACKUP_DIR/minio-data.tgz" > /dev/null
fi

compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$BACKUP_DIR/postgres.sql"

if [ -f "$BACKUP_DIR/minio-data.tgz" ]; then
  docker run --rm -i --volumes-from "$MINIO_CONTAINER" "$BACKUP_HELPER_IMAGE" \
    tar xzf - -C /data < "$BACKUP_DIR/minio-data.tgz"
fi

echo "Restore complete."
