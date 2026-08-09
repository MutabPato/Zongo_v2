#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${1:-docker-compose.yml}"
ADMIN_HOSTNAME_VALUE="${2:-admin.preview.test}"

render_gate() {
  enabled="$1"
  ADMIN_PANEL_ENABLED="$enabled" \
  ADMIN_HOSTNAME="$ADMIN_HOSTNAME_VALUE" \
  API_HOSTNAME="api.${ADMIN_HOSTNAME_VALUE}" \
  POSTGRES_USER=zongo \
  POSTGRES_PASSWORD=synthetic-password \
  POSTGRES_DB=zongo \
  REDIS_PASSWORD=synthetic-password \
  ADMINJS_COOKIE_SECRET=synthetic-adminjs-cookie-secret \
  BREAK_GLASS_SECRET=synthetic-break-glass-secret \
  ADMIN_CSRF_SECRET=synthetic-admin-csrf-secret \
  WEBAUTHN_RP_ID="$ADMIN_HOSTNAME_VALUE" \
  WEBAUTHN_ORIGIN="https://${ADMIN_HOSTNAME_VALUE}" \
  ADMIN_ORIGIN="https://${ADMIN_HOSTNAME_VALUE}" \
    docker compose -f "$COMPOSE_FILE" config --format json
}

for expected in true false; do
  config="$(render_gate "$expected")"
  printf '%s' "$config" | jq -e \
    --arg expected "$expected" \
    '.services["admin-panel"].labels["traefik.enable"] == $expected and
     .services["admin-panel"].labels["traefik.http.routers.zongo-admin-panel.priority"] == "100" and
     .services.admin.labels["traefik.http.routers.zongo-admin.priority"] == "10"' \
    >/dev/null
done

echo "route-gate rehearsal passed: ${COMPOSE_FILE} (${ADMIN_HOSTNAME_VALUE})"
