# Local browser smoke report

Date: 2026-08-09

Environment: rebuilt local paired stack at `http://127.0.0.1:4173/backoffice/`.

Current artifact: `custom-admin-panel-20260809-1407-local`.

Fixture: synthetic Support, Ops, and Admin identities. No production credentials or customer data were used.

Journeys captured:

- MFA login established the HttpOnly browser session and rendered the role-aware Overview shell.
- Support login rendered only Overview, Transactions, Reconciliation, Beneficiaries, Pilot readiness, and Audit trail; privileged Alerts, Verification, and Admin controls were not shown.
- Ops login rendered operational Alerts and Verification workspaces while Admin controls remained hidden.
- Overview rendered failed, pending, reconciliation, and alert queue cards with exact server-provided values.
- Transactions navigation rendered the operations search workspace and empty-state handling.
- Browser session remained cookie-based; no bearer token was exposed to the page.

Artifacts:

- `overview-admin.png` — authenticated Overview shell.
- `overview-support.png` — Support role navigation and role-aware Overview.
- `overview-ops.png` — Ops role navigation and role-aware Overview.
- `transactions-empty.png` — authenticated Transactions empty state.
- `current/overview-admin.png` — current-release Admin overview after the typed-client rebuild.
- `current/overview-support.png` — current-release Support role navigation and overview.
- `current/overview-ops.png` — current-release Ops role navigation and overview.

The single console error during initial page load was the expected unauthenticated `/admin/v1/auth/session` probe before MFA. No unexpected warnings were observed. This is local browser evidence and does not satisfy the required deployed preview parity, full workflow matrix, rollback rehearsal, observation window, or approvals.
