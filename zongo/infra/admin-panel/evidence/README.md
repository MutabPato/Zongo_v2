# Admin Panel Evidence Pack

Each candidate release creates an immutable evidence directory named by the release manifest `releaseId`. This directory is attached to the paired frontend/backend artifacts and is not populated with production secrets or unapproved personal data.

Required files:

- `release-manifest.json` — exact frontend/backend image digests and commit.
- `parity-matrix.csv` — one row for every inventory workflow, role, endpoint, and evidence reference.
- `unit-api-report.txt` — focused and full test output.
- `browser-report/` — deployed Playwright/real-browser report, trace, and sanitized screenshots.
- `security-data-audit.md` — cookie, CSRF, role, masking, reveal, audit, idempotency, and decimal-string assertions.
- `deployment-rollback.md` — preview routing, health checks, route switch, rollback result, and migration compatibility.
- `exceptions.md` — only accepted medium/low exceptions with owner, deadline, and impact.
- `approvals.md` — engineering, security, and operations-owner approvals.

The evidence pack is incomplete until all parity rows pass, no blocking defect remains, and the operations owner signs the route-switch gate. AdminJS removal requires a separate post-observation approval and a fresh evidence reference.

For local or preview contract checks, run `infra/admin-panel/verify-contract-smoke.sh <base-url>`. Without credentials it verifies routing, SPA fallback, OpenAPI availability, and unauthenticated denial. Set `ADMIN_SMOKE_USER` and `ADMIN_SMOKE_TOTP` only with synthetic credentials to additionally verify cookie-only login, CSRF, logout, and invalid-filter behavior; the script never prints response bodies or credentials.

For the required three-role HTTP matrix, run `infra/admin-panel/verify-role-matrix.sh <base-url>` with synthetic `ADMIN_SMOKE_SUPPORT_USER`/`ADMIN_SMOKE_SUPPORT_TOTP`, `ADMIN_SMOKE_OPS_USER`/`ADMIN_SMOKE_OPS_TOTP`, and `ADMIN_SMOKE_ADMIN_USER`/`ADMIN_SMOKE_ADMIN_TOTP` values. It verifies shared read access plus Support, Ops, and Admin denial/allowance boundaries without printing response bodies or credentials.
