# Legacy Admin route map

The legacy bearer routes below remain only for named internal clients and compatibility tests. The React panel uses the canonical `/admin/v1` route in the right-hand column. `admin-platform` owns the compatibility layer; review date is `2026-12-31`.

| Legacy route | Canonical panel route | Retention note |
| --- | --- | --- |
| `GET /admin` | `GET /admin/v1/auth/session` plus `/health/*` | compatibility service metadata only |
| `POST /admin/auth/login` | `POST /admin/v1/auth/login` | browser legacy; remove after cutover |
| `POST /admin/auth/hardware-key/register/options` | `POST /admin/v1/auth/webauthn/registration/options` | named clients/tests only |
| `POST /admin/auth/hardware-key/register/verify` | `POST /admin/v1/auth/webauthn/registration/verify` | named clients/tests only |
| `POST /admin/auth/hardware-key/login/options` | `POST /admin/v1/auth/webauthn/login/options` | named clients/tests only |
| `POST /admin/auth/hardware-key/login/verify` | `POST /admin/v1/auth/webauthn/login/verify` | named clients/tests only |
| `POST /admin/auth/break-glass` | `POST /admin/v1/auth/break-glass` | emergency compatibility only |
| `GET /admin/transactions/:reference` | `GET /admin/v1/operations/transactions/:reference` | named clients/tests only |
| `GET /admin/senders/:profileId/reveal` | `POST /admin/v1/operations/senders/:profileId/reveal` | canonical route is explicit mutation |
| `GET /admin/dashboard` | `GET /admin/v1/overview` | named clients/tests only |
| `GET /admin/operations/search` | `GET /admin/v1/operations/search` | named clients/tests only |
| `GET /admin/transactions/:reference/investigation` | `GET /admin/v1/operations/transactions/:reference` | named clients/tests only |
| `POST /admin/transactions/:reference/notes` | `POST /admin/v1/operations/transactions/:reference/notes` | named clients/tests only |
| `POST /admin/reconciliations/:reconciliationId/notes` | `POST /admin/v1/reconciliations/:id/notes` | named clients/tests only |
| `POST /admin/reconciliations/:reconciliationId/ownership` | `POST /admin/v1/reconciliations/:id/ownership` | named clients/tests only |
| `POST /admin/alerts/:alertId/acknowledge` | `POST /admin/v1/alerts/:id/acknowledge` | named clients/tests only |
| `POST /admin/alerts/:alertId/escalate` | `POST /admin/v1/alerts/:id/escalate` | named clients/tests only |
| `POST /admin/transactions/:reference/status-recheck` | `POST /admin/v1/operations/transactions/:reference/status-recheck` | named clients/tests only |
| `POST /admin/transactions/:reference/reconciliation` | `POST /admin/v1/operations/transactions/:reference/reconciliation` | named clients/tests only |
| `POST /admin/transactions/:reference/retry-payout` | `POST /admin/v1/operations/transactions/:reference/retry-payout` | named clients/tests only |
| `GET /admin/beneficiaries` | `GET /admin/v1/beneficiaries` | named clients/tests only |
| `GET /admin/verifications` | `GET /admin/v1/verification` | named clients/tests only |
| `POST /admin/verifications/:verificationId/review` | `POST /admin/v1/verification/:id/review` | named clients/tests only |
| `POST /admin/users/:userId/block` | `POST /admin/v1/users/:id/block` | Admin-only mutation |
| `POST /admin/users/:userId/unblock` | `POST /admin/v1/users/:id/unblock` | Admin-only mutation |
| `POST /admin/policies/tier-1-transfer-caps` | `POST /admin/v1/policies/tier-1-transfer-caps` | Admin-only mutation |
| `POST /admin/pilot/controls` | `POST /admin/v1/pilot/controls` | named clients/tests only |
| `POST /admin/pilot/engineering-isolation` | `POST /admin/v1/pilot/engineering-isolation` | named clients/tests only |
| `POST /admin/pilot/release/approvals` | `POST /admin/v1/pilot/readiness/approvals` | named clients/tests only |
| `POST /admin/pilot/release/publish` | `POST /admin/v1/pilot/readiness/publish` | separate cutover gate |
| `POST /admin/pilot/release/stages/:stage` | `POST /admin/v1/pilot/readiness/stages` | named clients/tests only |
| `GET /admin/pilot/release` | `GET /admin/v1/pilot/readiness` | named clients/tests only |
| `POST /admin/pilot/allowlist/:profileId` | `POST /admin/v1/pilot/allowlist/:profileId` | named clients/tests only |
| `POST /admin/pilot/exposure-policy` | `POST /admin/v1/pilot/exposure-policy` | named clients/tests only |

All legacy requests pass through the compatibility interceptor, which emits route/method/owner/review-date telemetry without recording credentials, bodies, or query data. No browser route is allowed to use this table after cutover.
