# 09 — Audit workspace and compatibility telemetry

**What to build:** Authorized operators can search the append-only audit trail, and the legacy admin API compatibility layer is observable and safe during migration.

**Blocked by:** 01 — Authenticated admin shell and `/admin/v1` foundation.

**Status:** in-progress

**Implementation note:** A role-gated audit read endpoint and explicit v1/legacy separation are in place; compatibility telemetry and deployed evidence remain.

- [x] Audit list/detail read models provide role-filtered, paginated, append-only visibility.
- [x] Audit records expose safe actor, role, target, reason, timestamp, and correlation references without editable controls.
- [x] Every legacy `/admin` alias is mapped to a `/admin/v1` operation and has usage/deprecation telemetry and an owner record.
- [x] Browser routes never depend on bearer compatibility, while named automation/tests remain covered.
- [ ] API and deployed browser tests cover audit visibility, masking, forbidden access, alias behavior, and telemetry.
