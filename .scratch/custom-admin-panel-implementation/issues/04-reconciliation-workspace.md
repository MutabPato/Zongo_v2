# 04 — Reconciliation workspace

**What to build:** Operators can inspect reconciliation exceptions, retain investigation notes, assign ownership, and escalate work from the Reconciliation workspace.

**Blocked by:** 02 — Overview and operations search.

**Status:** in-progress

**Implementation note:** Reconciliation listing, audited notes, assignment, and escalation are exposed through `/admin/v1`.

- [ ] Reconciliation list/detail read models use standard pagination, filtering, masking, and safe errors.
- [ ] Support/Ops/Admin can add notes according to capability; Ops/Admin can assign ownership and escalate with required reasons.
- [ ] No reconciliation state mutation outside the agreed ownership/escalation actions is exposed.
- [ ] Actions are audited with actor, target, reason, and correlation reference.
- [ ] API and deployed browser tests cover success, validation, denial, and failure behavior.
