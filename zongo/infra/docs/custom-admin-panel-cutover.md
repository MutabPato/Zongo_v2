# Custom Admin Panel Cutover Runbook

This runbook is the operational gate for replacing AdminJS. The React artifact and Nest admin artifact are released as an immutable pair and are validated on a dedicated preview hostname or isolated environment before the production route switch.

## Preview gate

1. Build both artifacts from the same immutable commit and record the release manifest.
2. Deploy the pair to the preview host. Verify `/backoffice/`, `/admin/v1/auth/session`, `/admin/v1/auth/csrf`, and `/health/*` through the same reverse-proxy security boundary.
3. Run the parity matrix with synthetic or approved sanitized fixtures for SUPPORT, OPS, and ADMIN, including denial paths and break-glass evidence.
4. Confirm browser cookies are host-only, Secure, HttpOnly, Path `/`, SameSite Lax; confirm mutations require CSRF and Origin validation.
5. Capture API contract, role, E2E, sensitive-data, audit, deployment, and rollback evidence in the release evidence pack.

## Controlled switch

The operations owner approves the route switch only when the evidence pack has no open critical/high security, authorization, sensitive-data, audit, money-value, or rollback defect. Switch `/backoffice` to the approved panel artifact for a short observation window. Keep the AdminJS target available as the reversible rollback target, but do not expose both products as long-term public choices.

Observe authentication failures, role denials, sensitive reveals and matching audit events, frontend/API error rates, latency, routing health, and workflow smoke/E2E results. A rollback returns the route to the AdminJS target without reversing data migrations.

## Removal gate

After the observation window, record explicit operations-owner approval. Migrate or document every named legacy bearer client with an owner and removal-review date. Verify no browser path uses bearer authentication. Only then remove the AdminJS mount, dependencies, generated assets, temporary configuration, and dual-product support in a separate cleanup release. Re-run health, smoke, browser, and rollback-relevant checks after removal.
