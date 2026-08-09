# Admin Panel Evidence Pack

Each candidate release creates an immutable evidence directory named by the release manifest `releaseId`. This directory is attached to the paired frontend/backend artifacts and is not populated with production secrets or unapproved personal data.

Required files:

- `release-manifest.json` — exact frontend/backend image digests and commit.
- `parity-matrix.csv` — one row for every inventory workflow, role, endpoint, and evidence reference.
- `unit-api-report.txt` — focused and full test output.
- `browser-report/` — deployed Playwright/real-browser report, trace, and sanitized screenshots.
- `security-data-audit.md` — cookie, CSRF, role, masking, reveal, audit, idempotency, and decimal-string assertions.
- `deployment-rollback.md` — preview routing, health checks, route switch, rollback result, and migration compatibility.
- `exceptions.md` — only accepted medium/low exceptions with owner, deadline, and impact.
- `approvals.md` — engineering, security, and operations-owner approvals.

The evidence pack is incomplete until all parity rows pass, no blocking defect remains, and the operations owner signs the route-switch gate. AdminJS removal requires a separate post-observation approval and a fresh evidence reference.
