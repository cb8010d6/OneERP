#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_PATH="$ROOT/.env"
TEMPLATE_PATH="$ROOT/.env.quickstart"
REQUIRED_ENV_KEYS="POSTGRES_PASSWORD JWT_SECRET MINIO_SECRET_KEY INIT_ADMIN_EMAIL INIT_ADMIN_PASSWORD CORS_ORIGINS"

secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "${1:-24}" | tr -d '=+/' | cut -c1-48
  else
    date +%s%N | sha256sum | cut -c1-48
  fi
}

env_value() {
  key="$1"
  if [ ! -f "$ENV_PATH" ]; then
    return
  fi
  grep -E "^$key=" "$ENV_PATH" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed "s/^['\"]//; s/['\"]$//"
}

validate_required_env() {
  missing=""
  for key in $REQUIRED_ENV_KEYS; do
    value="$(env_value "$key" || true)"
    case "$value" in
      ""|CHANGE_ME*)
        missing="${missing}${missing:+, }$key"
        ;;
    esac
  done

  if [ "$missing" != "" ]; then
    echo ".env is missing required deployment values: $missing" >&2
    echo "Fill them in .env, or remove .env and rerun scripts/quickstart.sh to generate local quickstart values." >&2
    exit 1
  fi
}

if [ ! -f "$ENV_PATH" ]; then
  if [ ! -f "$TEMPLATE_PATH" ]; then
    echo ".env.quickstart not found" >&2
    exit 1
  fi
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

validate_required_env
echo ".env required deployment values are present."

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
