# 11 — Controlled cutover and AdminJS removal

**What to build:** The operations owner can approve the custom panel route switch, complete the observation window, and remove AdminJS through a separately approved cleanup release.

**Blocked by:** 10 — Preview deployment, parity evidence, and rollback rehearsal.

**Status:** ready-for-agent

- [ ] Route switch to the custom panel is reversible and requires the completed evidence pack plus operations-owner approval.
- [ ] Heightened observation verifies auth, role access, sensitive reveal/audit behavior, frontend/API errors and latency, routing, and smoke/E2E outcomes.
- [ ] Any critical/high security, authorization, sensitive-data, audit, money-value, or rollback defect blocks removal.
- [ ] Named legacy clients are migrated or intentionally retained with ownership and removal-review dates.
- [ ] No browser route uses bearer authentication after cutover.
- [ ] AdminJS mount, dependencies, assets, temp configuration, and long-term dual-product support are removed only after separate approval.
- [ ] Post-removal health, smoke, browser, and rollback-relevant checks pass.
