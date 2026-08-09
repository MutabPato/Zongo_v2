# 03 — Transaction investigation and recovery actions

**What to build:** An operator can open a transaction investigation and safely perform the current transaction-support and recovery actions from one contextual workspace.

**Blocked by:** 02 — Overview and operations search.

**Status:** in-progress

**Implementation note:** Investigation, notes, status recheck, payout retry, reconciliation queue, and sensitive sender reveal endpoints are wired with CSRF and server-side authorization.

- [ ] Investigation returns the typed masked aggregate for transaction, ledger, reconciliation/notes, audit, worker jobs, beneficiary/retry context, and masked sender context.
- [ ] Support can add transaction notes; Ops/Admin can queue status rechecks, prepare eligible payout retries, and queue reconciliation.
- [ ] Authorized Ops/Admin actors can explicitly reveal sender fields through a no-store audited action; reveal is never implicit.
- [ ] Confirmation, validation, invalid-state, queued-versus-completed, idempotency, and safe error behavior are visible in the UI and API.
- [ ] Role-denial, masking, audit actor/target, and exact money-string behavior are tested.
- [ ] A deployed browser journey covers investigation and at least one recovery action for each permitted role.
