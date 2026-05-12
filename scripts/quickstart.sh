#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_PATH="$ROOT/.env"
TEMPLATE_PATH="$ROOT/.env.quickstart"

secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "${1:-24}" | tr -d '=+/' | cut -c1-48
  else
    date +%s%N | sha256sum | cut -c1-48
  fi
}

if [ ! -f "$ENV_PATH" ]; then
  cp "$TEMPLATE_PATH" "$ENV_PATH"
  sed -i "s/CHANGE_ME_DATABASE_PASSWORD/$(secret 18)/g" "$ENV_PATH"
  sed -i "s/CHANGE_ME_JWT_SECRET/$(secret 48)/g" "$ENV_PATH"
  sed -i "s/CHANGE_ME_MINIO_SECRET/$(secret 24)/g" "$ENV_PATH"
  sed -i "s/CHANGE_ME_ADMIN_PASSWORD/$(secret 18)/g" "$ENV_PATH"
  echo "Created .env with generated secrets."
  echo "Admin email: admin@oneerp.local"
  echo "Admin password is in .env as INIT_ADMIN_PASSWORD."
else
  echo ".env already exists; keeping current values."
fi

cd "$ROOT"
if [ "${1:-}" = "--rebuild" ]; then
  docker compose -f docker-compose.easy.yml up -d --build
else
  docker compose -f docker-compose.easy.yml up -d
fi

echo ""
echo "OneERP is starting."
echo "Web: http://localhost:3000"
echo "API: http://localhost:8000/api/docs"
echo "Check status: docker compose -f docker-compose.easy.yml ps"
