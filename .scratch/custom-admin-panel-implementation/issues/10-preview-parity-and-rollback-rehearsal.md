# 10 — Preview deployment, parity evidence, and rollback rehearsal

**What to build:** The paired frontend/backend release runs on preview or isolated infrastructure and produces the evidence needed to approve a reversible cutover.

**Blocked by:** 03 — Transaction investigation and recovery actions; 04 — Reconciliation workspace; 05 — Beneficiary review workspace; 06 — Verification review workspace; 07 — Alert handling workspace; 08 — Admin controls and pilot readiness workspace; 09 — Audit workspace and compatibility telemetry.

**Status:** in-progress

**Implementation note:** Paired Docker artifacts, same-host routing, release manifest template, cutover runbook, and local paired-stack smoke evidence are in place; deployed preview parity and rollback evidence remain.

- [ ] Frontend and backend artifacts are immutable, version-paired, and represented in a release manifest.
- [ ] Preview/isolated routing serves `/backoffice` to the SPA and `/admin/*`/health routes to Nest under the same security boundary.
- [ ] Hashed assets, entry-document caching, readiness checks, SPA fallback, cookie/CSRF behavior, and dependency health are verified.
- [ ] The full parity matrix has unit, API contract, and deployed Playwright evidence for every workflow and role/denial path.
- [ ] Synthetic or approved sanitized fixtures are used; sensitive values do not enter traces, screenshots, logs, or release artifacts.
- [ ] Rollback to the AdminJS target is rehearsed without destructive migration reversal.
- [ ] The versioned evidence pack records results, defects/exceptions, rollback outcome, observation signals, and required approvals.
