# Local browser smoke report

Date: 2026-08-09

Environment: rebuilt local paired stack at `http://127.0.0.1:4173/backoffice/`.

Fixture: synthetic Admin identity only. No production credentials or customer data were used.

Journeys captured:

- MFA login established the HttpOnly browser session and rendered the role-aware Overview shell.
- Overview rendered failed, pending, reconciliation, and alert queue cards with exact server-provided values.
- Transactions navigation rendered the operations search workspace and empty-state handling.
- Browser session remained cookie-based; no bearer token was exposed to the page.

Artifacts:

- `overview-admin.png` — authenticated Overview shell.
- `transactions-empty.png` — authenticated Transactions empty state.

The single console error during initial page load was the expected unauthenticated `/admin/v1/auth/session` probe before MFA. No unexpected warnings were observed. This is local browser evidence and does not satisfy the required deployed preview parity, full workflow matrix, rollback rehearsal, observation window, or approvals.
