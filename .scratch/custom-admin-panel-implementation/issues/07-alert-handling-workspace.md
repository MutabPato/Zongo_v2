# 07 — Alert handling workspace

**What to build:** Operators can review alert deliveries and acknowledge or escalate alerts with attributable reasons.

**Blocked by:** 02 — Overview and operations search.

**Status:** in-progress

**Implementation note:** Alert listing and reason-required acknowledge/escalate actions are exposed through the v1 API and panel actions.

- [ ] Alert list/detail read models use standard pagination, role filtering, masking, and safe errors.
- [ ] Permitted operators can acknowledge or escalate alerts with required reasons and idempotent action behavior.
- [ ] Results distinguish accepted handling from downstream delivery completion where applicable.
- [ ] Audit and correlation references are visible without exposing webhook secrets or stack traces.
- [ ] API and deployed browser tests cover success, denial, validation, duplicate submission, and failure paths.
