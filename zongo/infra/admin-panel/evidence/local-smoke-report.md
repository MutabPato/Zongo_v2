# Local paired-stack smoke report

Date: 2026-08-09

Environment: `docker-compose.local.yml`, synthetic local admin identity from `.env.local`, panel at `http://127.0.0.1:4173/backoffice/`, Nest admin at the same browser origin through the panel proxy.

Passed:

- Panel container built from the current workspace and served `/backoffice/` with SPA fallback for `/backoffice/transactions`.
- CSP, referrer, frame, content-type, and no-cache headers were present; Emotion/MUI styles loaded after the CSP fix.
- Nest OpenAPI returned 94 documented paths and included `/admin/v1/auth/login` and alert detail.
- Playwright real-browser TOTP login established the ADMIN session and rendered the role-aware domain workspace.
- Authenticated operations search returned the standard list envelope with seeded synthetic records.
- Transaction investigation rendered a masked amount and controlled recovery controls.
- CSRF-protected status recheck completed end to end and showed `Status recheck queued`.
- Logout returned the browser to the MFA entry point.
- Synthetic Support login hid privileged recovery controls; the current Support-safe reconciliation/beneficiary read policy is covered by service regression tests.
- Synthetic Ops login showed operational workspaces and recovery controls; synthetic Admin login showed the full workspace including Admin controls.
- A server-side Support request to `/admin/v1/reconciliation` is authorized for read access while ownership/escalation remains Ops/Admin-only.
- A state-changing request without `X-CSRF-Token` returned safe `403 ADMIN_403` with a correlation id.
- `infra/admin-panel/verify-preview.sh http://127.0.0.1:4173` passed.
- Fresh browser smoke against the rebuilt image rendered Beneficiary review/search and Admin controls, including the structured policy snapshot and reason-gated control forms.
- Fresh browser smoke confirmed policy/readiness timestamps are serialized as ISO strings rather than object placeholders.
- Browser console was clean after the expected unauthenticated `/admin/v1/auth/session` probe during initial page load.
- Entry-document caching is `no-cache`, while hashed panel assets return `immutable` long-lived caching.
- Reference search remains functional in the local image without optional blind-index environment keys; encrypted-field search falls back to approved non-sensitive reference/name criteria.
- Transaction investigation now renders ledger, worker, reconciliation, notes, audit, beneficiary, retry, masked sender, and controlled-action context.
- Browser logout now revokes the durable session and records an `admin.logout` audit event.
- Rebuilt-image in-container checks returned 200 for `/backoffice/`, SPA fallback, and `/admin/v1/openapi-json`; the entry document was `no-cache` and the hashed asset was `immutable`.
- Production Compose route-gate dry runs rendered `ADMIN_PANEL_ENABLED=true` for the panel state and `false` for the AdminJS rollback state, with the Nest fallback at priority 10. No live Traefik route switch was performed locally.
- Static panel-client boundary scan found no `localStorage`, `sessionStorage`, `Authorization`, or raw `accessToken` usage; browser authentication remains cookie/session based.
- Repository HTTP E2E suites passed with the local database configuration (API root and existing Admin compatibility endpoint); these do not replace the required deployed panel parity journeys.
- `verify-contract-smoke.sh` passed against the freshly rebuilt local panel with synthetic TOTP credentials: cookie-only login, `HttpOnly`/`SameSite=Lax`/`Path=/`, authenticated session and CSRF acquisition, CSRF-denied logout, invalid status-filter 400, and successful logout.
- The paired admin services were recreated from the current release source, and the authenticated contract smoke plus `verify-preview.sh` passed again against the current containers.
- The three-role matrix runner is available at `infra/admin-panel/verify-role-matrix.sh`; it uses named synthetic Support, Ops, and Admin credentials when enabled in the local environment.
- With opt-in local Support/Ops fixtures enabled, `verify-role-matrix.sh` passed for Support, Ops, and Admin, including session-role assertions, read visibility, role-appropriate mutation denial, CSRF, and logout.

Not release-complete: this is local evidence only. The full three-role parity matrix, deployed preview/isolated Playwright evidence, rollback rehearsal, observation window, and operations-owner approvals remain required before AdminJS removal.
