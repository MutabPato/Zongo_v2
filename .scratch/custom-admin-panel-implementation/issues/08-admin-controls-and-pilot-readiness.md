# 08 — Admin controls and pilot readiness workspace

**What to build:** Admin operators can manage access, policy, pilot controls, and readiness evidence through the Admin controls and Pilot readiness workspaces.

**Blocked by:** 01 — Authenticated admin shell and `/admin/v1` foundation.

**Status:** in-progress

**Implementation note:** Pilot controls, user blocking, tier caps, allowlist, exposure policy, readiness, and approval/publish routes are exposed through the v1 boundary.

- [x] Admin can block/unblock identities with confirmation, reasons where required, and audit evidence.
- [x] Admin can view and update Tier 1 caps using exact decimal-string values and server-side policy validation.
- [x] Admin can view and operate pilot controls, engineering isolation, allowlists, exposure policy, readiness stages, approvals, and publication according to authority rules.
- [x] Actions are idempotent where consequential, distinguish queued from completed, and expose safe audit/correlation references.
- [ ] Support/Ops denial and Admin success paths are covered by API and deployed browser tests.
