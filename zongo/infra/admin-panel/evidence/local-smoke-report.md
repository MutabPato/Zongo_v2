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
- `infra/admin-panel/verify-preview.sh http://127.0.0.1:4173` passed.

Not release-complete: this is local evidence only. The full three-role parity matrix, deployed preview/isolated Playwright evidence, rollback rehearsal, observation window, and operations-owner approvals remain required before AdminJS removal.
