# Release checklist

- [ ] Frontend and backend images are built from the same immutable commit and recorded by digest.
- [ ] Preview hostname serves `/backoffice/`; Nest serves `/admin/v1/*` and health routes under the same admin hostname/security boundary.
- [ ] SPA fallback, hashed assets, entry-document caching, cookie attributes, CSRF, Origin/Referer, and no-store responses verified.
- [ ] Support, Ops, and Admin positive and denial journeys pass in the parity matrix.
- [ ] Sensitive reveal is explicit, no-store, masked by default, and has matching audit/alert evidence.
- [ ] Money and bigint values remain exact decimal strings in API payloads and UI rendering.
- [ ] Consequential actions have idempotency and queued-versus-completed evidence.
- [ ] Rollback to AdminJS is rehearsed without reversing migrations.
- [ ] Observation window passes auth, authorization, sensitive-data, audit, latency, error, routing, and smoke checks.
- [ ] Operations owner approves route switch.
- [ ] AdminJS removal has a separate approval and named legacy-client decision.
