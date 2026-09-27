#!/usr/bin/env sh
set -eu
set -f

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.ha-lite.yml}"
ENV_FILE="${ENV_FILE:-.env}"
RESULTS="$ROOT/deploy-check-report.json"
FAILED=0

case "$ENV_FILE" in
  /*) ENV_PATH="$ENV_FILE" ;;
  *) ENV_PATH="$ROOT/$ENV_FILE" ;;
esac
case "$COMPOSE_FILE" in
  /*) COMPOSE_PATH="$COMPOSE_FILE" ;;
  *) COMPOSE_PATH="$ROOT/$COMPOSE_FILE" ;;
esac

env_value() {
  key="$1"
  default="$2"
  if [ -f "$ENV_PATH" ]; then
    value="$(grep -E "^$key=" "$ENV_PATH" | tail -n 1 | cut -d= -f2- || true)"
    [ "$value" != "" ] && printf '%s' "$value" && return
  fi
  printf '%s' "$default"
}

check() {
  name="$1"
  shift
  if "$@"; then echo "[PASS] $name"; else echo "[FAIL] $name"; FAILED=$((FAILED + 1)); fi
}

strong_secret() {
  key="$1"
  value="$(env_value "$key" "")"
  [ "${#value}" -ge 16 ] && [ "${value#CHANGE_ME}" = "$value" ]
}

compose() {
  if [ -f "$ENV_PATH" ]; then
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose -f "$COMPOSE_PATH" "$@"
  fi
}

compose_config_valid() { compose config >/dev/null 2>&1; }

load_compose_services() {
  CONFIG_SERVICES="$(compose config --services 2>/dev/null)" || return 1
  [ -n "$CONFIG_SERVICES" ]
}

compose_has_service() {
  [ -n "$CONFIG_SERVICES" ] && printf '%s\n' "$CONFIG_SERVICES" | grep -Fxq "$1"
}

INSPECT_FORMAT='{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}'
PROBE_STATE=''
PROBE_DETAIL=''

probe_service() {
  probe_name="$1"
  probe_mode="$2"
  ids="$(compose ps --all -q "$probe_name" 2>/dev/null)" || {
    PROBE_STATE=failed
    PROBE_DETAIL='docker compose ps failed'
    return
  }
  if [ -z "$ids" ]; then
    PROBE_STATE=pending
    PROBE_DETAIL='container is not present yet'
    return
  fi

  PROBE_STATE=ready
  PROBE_DETAIL='running and healthy'
  for container_id in $ids; do
    [ -n "$container_id" ] || continue
    state_line="$(docker inspect --format "$INSPECT_FORMAT" "$container_id" 2>/dev/null)" || {
      PROBE_STATE=failed
      PROBE_DETAIL='container state inspection failed'
      break
    }
    status="${state_line%%|*}"
    rest="${state_line#*|}"
    health="${rest%%|*}"
    exit_code="${rest#*|}"
    if [ "$status" = "$state_line" ] || [ "$health" = "$rest" ] || [ "$exit_code" = "$rest" ]; then
      PROBE_STATE=failed
      PROBE_DETAIL='container state inspection returned invalid fields'
      break
    fi

    if [ "$probe_mode" = migration ]; then
      if [ "$status" = exited ] && [ "$exit_code" = 0 ]; then
        :
      elif [ "$status" = running ] || [ "$status" = created ]; then
        [ "$PROBE_STATE" = failed ] || PROBE_STATE=pending
        PROBE_DETAIL="migration status=$status"
      else
        PROBE_STATE=failed
        PROBE_DETAIL="migration status=$status exitCode=$exit_code"
        break
      fi
    elif [ "$status" = running ]; then
      case "$health" in
        healthy|none) : ;;
        starting)
          [ "$PROBE_STATE" = failed ] || PROBE_STATE=pending
          PROBE_DETAIL='container health is starting'
          ;;
        unhealthy)
          PROBE_STATE=failed
          PROBE_DETAIL='container health is unhealthy'
          break
          ;;
        *)
          PROBE_STATE=failed
          PROBE_DETAIL="container health state is $health"
          break
          ;;
      esac
    elif [ "$status" = created ]; then
      [ "$PROBE_STATE" = failed ] || PROBE_STATE=pending
      PROBE_DETAIL='container has not started yet'
    else
      PROBE_STATE=failed
      PROBE_DETAIL="container status=$status"
      break
    fi
  done
}

DEPLOY_CHECK_TIMEOUT_SECONDS="${DEPLOY_CHECK_TIMEOUT_SECONDS:-60}"
DEPLOY_CHECK_POLL_SECONDS="${DEPLOY_CHECK_POLL_SECONDS:-3}"
case "$DEPLOY_CHECK_TIMEOUT_SECONDS" in ''|*[!0-9]*) DEPLOY_CHECK_TIMEOUT_SECONDS=60 ;; esac
case "$DEPLOY_CHECK_POLL_SECONDS" in ''|*[!0-9]*) DEPLOY_CHECK_POLL_SECONDS=3 ;; esac
DEPLOY_CHECK_TIMEOUT_SECONDS="$(printf '%s' "$DEPLOY_CHECK_TIMEOUT_SECONDS" | sed 's/^0*//')"
DEPLOY_CHECK_POLL_SECONDS="$(printf '%s' "$DEPLOY_CHECK_POLL_SECONDS" | sed 's/^0*//')"
[ -n "$DEPLOY_CHECK_TIMEOUT_SECONDS" ] || DEPLOY_CHECK_TIMEOUT_SECONDS=0
[ -n "$DEPLOY_CHECK_POLL_SECONDS" ] || DEPLOY_CHECK_POLL_SECONDS=0
[ "${#DEPLOY_CHECK_TIMEOUT_SECONDS}" -le 3 ] || DEPLOY_CHECK_TIMEOUT_SECONDS=900
[ "${#DEPLOY_CHECK_POLL_SECONDS}" -le 2 ] || DEPLOY_CHECK_POLL_SECONDS=60
[ "$DEPLOY_CHECK_TIMEOUT_SECONDS" -le 900 ] || DEPLOY_CHECK_TIMEOUT_SECONDS=900
[ "$DEPLOY_CHECK_POLL_SECONDS" -le 60 ] || DEPLOY_CHECK_POLL_SECONDS=60
[ "$DEPLOY_CHECK_POLL_SECONDS" -gt 0 ] || DEPLOY_CHECK_POLL_SECONDS=1

wait_for_compose_runtime() {
  required_services='api web db redis minio'
  migration_declared=0
  compose_has_service migrate && migration_declared=1
  runtime_report=''
  runtime_pending=0
  runtime_failure=0
  timed_out=0
  deadline=$(( $(date +%s) + DEPLOY_CHECK_TIMEOUT_SECONDS ))

  while :; do
    runtime_report=''
    runtime_pending=0
    runtime_failure=0
    for runtime_service in $required_services; do
      if compose_has_service "$runtime_service"; then
        probe_service "$runtime_service" runtime
      else
        PROBE_STATE=failed
        PROBE_DETAIL='service is not defined in selected Compose configuration'
      fi
      runtime_report="${runtime_report}${runtime_service}|${PROBE_STATE}|${PROBE_DETAIL}
"
      [ "$PROBE_STATE" = pending ] && runtime_pending=1
      [ "$PROBE_STATE" = failed ] && runtime_failure=1
    done

    if [ "$migration_declared" -eq 1 ]; then
      probe_service migrate migration
      runtime_report="${runtime_report}migrate|${PROBE_STATE}|${PROBE_DETAIL}
"
      [ "$PROBE_STATE" = pending ] && runtime_pending=1
      [ "$PROBE_STATE" = failed ] && runtime_failure=1
    fi

    [ "$runtime_failure" -eq 1 ] && break
    [ "$runtime_pending" -eq 0 ] && break
    if [ "$(date +%s)" -ge "$deadline" ]; then
      timed_out=1
      break
    fi
    sleep "$DEPLOY_CHECK_POLL_SECONDS"
  done

  runtime_passed=1
  while IFS='|' read -r runtime_service outcome detail; do
    [ -n "$runtime_service" ] || continue
    if [ "$outcome" = ready ]; then
      echo "[PASS] runtime-$runtime_service"
    else
      runtime_passed=0
      if [ "$outcome" = pending ] && [ "$timed_out" -eq 1 ]; then
        detail="timed out waiting: $detail"
      elif [ "$outcome" = pending ]; then
        detail="not ready: $detail"
      fi
      echo "[FAIL] runtime-$runtime_service - $detail"
    fi
  done <<EOF
$runtime_report
EOF
  [ "$runtime_passed" -eq 1 ]
}

API_PORT="$(env_value API_PORT 8000)"
WEB_PORT="$(env_value WEB_PORT 3000)"
if [ "${API_BASE_URL:-}" != "" ] && [ "${API_URL:-}" = "" ]; then
  API_URL="${API_BASE_URL%/}/health"
fi
if [ "${WEB_BASE_URL:-}" != "" ] && [ "${WEB_URL:-}" = "" ]; then
  WEB_URL="$WEB_BASE_URL"
fi
API_URL="${API_URL:-http://localhost:$API_PORT/api/health}"
WEB_URL="${WEB_URL:-http://localhost:$WEB_PORT/}"

cd "$ROOT"
check docker docker version
check compose-config compose_config_valid
check env-file test -f "$ENV_PATH"
check secret-POSTGRES_PASSWORD strong_secret POSTGRES_PASSWORD
check secret-JWT_SECRET strong_secret JWT_SECRET
check secret-MINIO_SECRET_KEY strong_secret MINIO_SECRET_KEY
check secret-INIT_ADMIN_PASSWORD strong_secret INIT_ADMIN_PASSWORD
check compose-services load_compose_services
check compose-ps wait_for_compose_runtime
check api-health curl --connect-timeout 5 --max-time 15 -fsS "$API_URL"
check web-root curl --connect-timeout 5 --max-time 15 -fsS "$WEB_URL"

cat > "$RESULTS" <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "composeFile": "$COMPOSE_FILE",
  "apiUrl": "$API_URL",
  "webUrl": "$WEB_URL",
  "failed": $FAILED
}
EOF

[ "$FAILED" -eq 0 ]
