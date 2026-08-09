# Release checklist

- [x] Frontend and backend images are built from the same immutable commit and recorded by digest in the local paired manifest.
- [ ] Preview hostname serves `/backoffice/`; Nest serves `/admin/v1/*` and health routes under the same admin hostname/security boundary.
- [x] SPA fallback, hashed assets, entry-document caching, cookie attributes, CSRF, Origin/Referer, and no-store responses verified locally.
- [ ] Support, Ops, and Admin positive and denial journeys pass in the parity matrix.
- [x] Sensitive reveal is explicit, no-store, masked by default, and has matching audit/alert evidence in local/API tests.
- [x] Money and bigint values remain exact decimal strings in API payloads and UI rendering.
- [x] Consequential actions have idempotency and queued-versus-completed evidence in local/API tests.
- [ ] Rollback to AdminJS is rehearsed without reversing migrations.
- [ ] `ADMIN_PANEL_ENABLED=true` and `ADMIN_PANEL_ENABLED=false` route-switch states are rehearsed and recorded.
- [ ] Observation window passes auth, authorization, sensitive-data, audit, latency, error, routing, and smoke checks.
- [ ] Operations owner approves route switch.
- [ ] AdminJS removal has a separate approval and named legacy-client decision.
