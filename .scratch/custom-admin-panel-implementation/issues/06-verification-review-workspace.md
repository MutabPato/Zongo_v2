# 06 — Verification review workspace

**What to build:** Ops and Admin can review verification cases and record explicit human-review decisions from the Verification workspace.

**Blocked by:** 02 — Overview and operations search.

**Status:** in-progress

**Implementation note:** Verification queue and approve/reject/escalate actions are exposed through the v1 API and panel actions.

- [ ] Verification list/detail read models expose the review state and evidence needed by the permitted operator without leaking restricted data.
- [ ] Approved, rejected, and escalated decisions require a decision reason and are validated server-side.
- [ ] Reviewer independence and role policy are enforced by the backend, not only by UI visibility.
- [ ] Each decision records immutable audit evidence and safe result/correlation references.
- [ ] API and deployed browser tests cover allowed roles, denied roles, invalid decisions, and successful decisions.
