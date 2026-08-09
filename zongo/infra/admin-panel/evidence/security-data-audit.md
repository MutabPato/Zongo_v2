# Security and data assertions

Release: `custom-admin-panel-20260809-1340-local`

- Browser authentication uses the host-only `zongo_admin_session` cookie; the panel does not use browser storage, `Authorization`, or raw access tokens. The canonical `/admin/v1` controller rejects bearer-only requests; bearer compatibility remains in the explicitly legacy `/admin/*` controller for named internal clients/tests.
- Local authenticated smoke verified `HttpOnly`, `SameSite=Lax`, and `Path=/` cookie attributes.
- State-changing browser requests require the session-bound CSRF header; missing CSRF returned `403 ADMIN_403` locally.
- Role matrix verified Support/Ops/Admin session roles and role-appropriate read/mutation boundaries.
- Sensitive sender data is masked by default; explicit reveal is server-authorized, no-store, and audited.
- `maskAdminData` serializes bigint values as decimal strings and dates as ISO strings.
- Audit and sensitive-action paths avoid credentials, ciphertexts, webhook secrets, and stack traces in panel responses.

Preview browser, trace, and sanitized screenshot evidence is still required before cutover.
