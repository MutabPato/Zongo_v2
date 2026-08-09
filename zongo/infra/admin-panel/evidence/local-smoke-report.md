# Local paired-stack smoke report

Date: 2026-08-09

Environment: `docker-compose.local.yml`, synthetic local admin identity from `.env.local`, panel at `http://127.0.0.1:4173/backoffice/`, Nest admin at the same browser origin through the panel proxy.

Passed:

- Panel container built from the current workspace and served `/backoffice/` with SPA fallback for `/backoffice/transactions`.
- CSP, referrer, frame, content-type, and no-cache headers were present; Emotion/MUI styles loaded after the CSP fix.
- Nest OpenAPI returned 73 documented paths and included `/admin/v1/auth/login`.
- Playwright real-browser TOTP login established the ADMIN session and rendered the role-aware domain workspace.
- Authenticated operations search returned the standard list envelope with seeded synthetic records.
- Transaction investigation rendered a masked amount and controlled recovery controls.
- CSRF-protected status recheck completed end to end and showed `Status recheck queued`.
- Logout returned the browser to the MFA entry point.
- Synthetic Support login showed only Overview, Transactions, and Audit navigation and hid privileged recovery controls.
- Synthetic Ops login showed operational workspaces and recovery controls; synthetic Admin login showed the full workspace including Admin controls.
- A server-side Support request to `/admin/v1/reconciliation` returned safe `403 ADMIN_403` with a correlation id.
- A state-changing request without `X-CSRF-Token` returned safe `403 ADMIN_403` with a correlation id.
- `infra/admin-panel/verify-preview.sh http://127.0.0.1:4173` passed.
- Fresh browser smoke against the rebuilt image rendered Beneficiary review/search and Admin controls, including the structured policy snapshot and reason-gated control forms.
- Fresh browser smoke confirmed policy/readiness timestamps are serialized as ISO strings rather than object placeholders.
- Browser console was clean after the expected unauthenticated `/admin/v1/auth/session` probe during initial page load.
- Entry-document caching is `no-cache`, while hashed panel assets return `immutable` long-lived caching.
- Reference search remains functional in the local image without optional blind-index environment keys; encrypted-field search falls back to approved non-sensitive reference/name criteria.
- Transaction investigation now renders ledger, worker, reconciliation, notes, audit, beneficiary, retry, masked sender, and controlled-action context.

Not release-complete: this is local evidence only. The full three-role parity matrix, deployed preview/isolated Playwright evidence, rollback rehearsal, observation window, and operations-owner approvals remain required before AdminJS removal.
