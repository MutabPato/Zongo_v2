# Legacy Admin Compatibility Inventory

The legacy `/admin/*` bearer surface is temporary and is not a browser contract. Every retained caller must be named, owned, and reviewed before the AdminJS cleanup release.

| Client | Current aliases | Owner | Migration/removal review | Browser use permitted after cutover |
| --- | --- | --- | --- | --- |
| Admin E2E compatibility suite | `/admin`, legacy auth and workflow routes | admin-platform | 2026-12-31 | No |
| Internal operations automation | Must be registered here before retention | named team required | assigned per client | No |
| Other callers | No unregistered callers permitted | — | — | No |

The compatibility interceptor emits `admin.legacy-route.used` telemetry with the route, method, owner, and review date while never logging bearer values, request bodies, or query values. A cleanup release may remove aliases only after named callers are migrated or explicitly approved for non-browser retention.

See [`custom-admin-legacy-route-map.md`](./custom-admin-legacy-route-map.md) for the complete route-by-route mapping to `/admin/v1`.
