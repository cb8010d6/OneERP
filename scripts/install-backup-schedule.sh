#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
POLICY_FILE="${POLICY_FILE:-ops/backup-policy.example.json}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
POLICY_PATH="$ROOT/$POLICY_FILE"

if [ ! -f "$POLICY_PATH" ]; then
  echo "Policy file not found: $POLICY_PATH"
  exit 1
fi

INTERVAL="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.postgresIntervalMinutes||15));" "$POLICY_PATH")"
if [ "$INTERVAL" -lt 5 ]; then
  echo "postgresIntervalMinutes must be at least 5"
  exit 1
fi

MARKER_BEGIN="# OneERP backup schedule begin"
MARKER_END="# OneERP backup schedule end"
TMP="$(mktemp)"
crontab -l 2>/dev/null | sed "/$MARKER_BEGIN/,/$MARKER_END/d" > "$TMP" || true
{
  cat "$TMP"
  echo "$MARKER_BEGIN"
  echo "*/$INTERVAL * * * * cd '$ROOT' && POLICY_FILE='$POLICY_FILE' COMPOSE_FILE='$COMPOSE_FILE' sh scripts/backup.sh >> '$ROOT/backups/backup.log' 2>&1"
  echo "$MARKER_END"
} | crontab -
rm -f "$TMP"

echo "Installed cron backup schedule every $INTERVAL minutes."
