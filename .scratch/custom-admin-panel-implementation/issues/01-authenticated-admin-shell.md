# 01 — Authenticated admin shell and `/admin/v1` foundation

**What to build:** An operator can open the custom panel, complete the supported MFA journey, receive a secure same-site browser session, and reach a role-aware domain workspace shell. The Nest API exposes the shared `/admin/v1` contract foundation and the typed frontend client can handle safe errors, CSRF, capabilities, and legacy bearer compatibility.

**Blocked by:** None — can start immediately.

**Status:** in-progress

**Implementation note:** The standalone Vite/MUI panel, `/admin/v1` browser session boundary, CSRF contract, lifecycle fields, and role-aware shell are implemented. Remaining evidence is tracked in the parity gate.

- [x] Vite React TypeScript panel is served at `/backoffice` with the selected domain-workspace shell and persistent navigation.
- [x] TOTP login, WebAuthn login/registration policy, logout, expiry/revocation handling, and admin-only break-glass are exposed with the agreed session semantics.
- [x] Browser sessions use the agreed host-only Secure HttpOnly SameSite cookie; raw bearer tokens are not exposed to React or browser storage.
- [x] CSRF token acquisition, mutation header, same-origin checks, safe error/correlation handling, and capability loading work end to end.
- [x] `/admin/v1` DTO/runtime-validation/OpenAPI/client foundation is available, with decimal-string transport for bigint values.
- [x] Existing named bearer clients/tests remain compatible and are covered by tests.
- [ ] Unit, API contract, and deployed browser tests cover authentication success and denial paths.
