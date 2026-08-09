# Deployment and rollback evidence

Release: `custom-admin-panel-20260809-1340-local`

## Verified locally

- Frontend and Nest artifacts were rebuilt as a paired release and recorded in `local-release-manifest.json`.
- `/backoffice/`, SPA fallback, `/admin/v1/openapi-json`, and security/cache headers passed `verify-preview.sh`.
- `ADMIN_PANEL_ENABLED=true` and `ADMIN_PANEL_ENABLED=false` Compose route-gate configurations render successfully; the AdminJS fallback remains priority 10.
- `infra/admin-panel/verify-route-gate.sh docker-compose.yml admin.preview.test` reproduces and verifies both route-gate states.
- The current local containers passed cookie/CSRF contract smoke and the three-role Support/Ops/Admin matrix.

## Not yet rehearsed

- No live Traefik route switch has been performed.
- No preview-host rollback to the AdminJS target has been performed.
- No production migration reversal is permitted or required; the intended rollback is routing-only.

The release remains blocked for cutover until a dedicated preview or isolated environment records both route states, health checks, rollback outcome, and observation signals.
