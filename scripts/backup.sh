#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$ROOT/backups/$STAMP"

mkdir -p "$TARGET"
cd "$ROOT"

docker compose -f docker-compose.easy.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > "$TARGET/postgres.sql"
docker compose -f docker-compose.easy.yml exec -T minio sh -c "cd /data && tar czf - ." > "$TARGET/minio-data.tgz"
cp .env "$TARGET/.env.copy"

echo "Backup written to $TARGET"
