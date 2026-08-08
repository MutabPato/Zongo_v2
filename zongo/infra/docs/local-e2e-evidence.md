# Local E2E Evidence Record

Record the exact commit, configuration, database migration state, controlled
partner behavior, and evidence links. Passing unit tests alone is insufficient.

- Commit/image digest: `7c275166513b7260c7d7658b62c4e4781280a50c`
- Environment and migration hash: local PostgreSQL/Redis; Prisma schema
  `32c071861caaa3eb4a247bd33a4f211296b80cfa1834551d2ebcef814705abe1`
- Partner stub/cassette: controlled in-process `PartnerPort`
- Evidence directory: repository test output; no external customer or partner data

## Executed automated evidence

The database-backed journey is executable from the repository with a controlled
`PartnerPort` that returns deterministic successful CDF collection and KES payout
references. The test invokes the signed WhatsApp controller, session service,
atomic initiation service, worker processor, ledger, reconciliation, and
notification boundary against PostgreSQL:

```sh
DATABASE_URL='postgresql://<local-credentials>@<postgres-host>:<port>/zongo?schema=public' \
  pnpm test:integration
```

Latest verified result in the local stack: `2` suites passed and `3` tests
passed. The worker container must be stopped during this controlled run so it
cannot claim the test's durable jobs with a different runtime configuration;
restart it immediately after the run. The test does not use production partner
credentials or send customer notifications externally.

Most recent controlled run record:

- Commit: `7c275166513b7260c7d7658b62c4e4781280a50c`
- Prisma schema hash: `32c071861caaa3eb4a247bd33a4f211296b80cfa1834551d2ebcef814705abe1`
- Executed at: `2026-08-08T23:35:33Z`
- Command: `DATABASE_URL='<local-only PostgreSQL URL>' pnpm test:integration`
- Worker state during test: stopped; PostgreSQL and Redis healthy
- Result: `2` suites passed, `3` tests passed
- Worker state after test: running; no production partner credentials or
  external customer notifications used
- Global pilot start/resume also fails closed when the persisted publication
  fingerprint does not recompute from the stored release facts.
- Pilot Ready publication now additionally requires a valid HMAC signature
  from the runtime-only release signing key.

Covered by `apps/worker/test/local-e2e.customer-journey.integration.spec.ts`:

- signed WhatsApp intake and localized consent;
- allowlisted, verified sender eligibility and encrypted payout-account use;
- atomic initiation, same-key replay, conflicting-key rejection, and active-chat contention;
- durable collection and payout jobs;
- ledger entries, reconciliation consistency, session closure, and notification delivery;
- timeout to `WAITING`, status-only query handling, and durable status-recheck job;
- manual payout recovery with the original beneficiary preserved and a separate retry target.
- support investigation through the AdminService boundary with masked sender data
  and no lifecycle mutation.

The record remains `INCOMPLETE` until the controlled run records the exact
commit/configuration and the remaining named operational gates have their own
executable evidence. The journey includes a database-backed notification
failure-isolation assertion; callback authentication and ordering/replay are
covered at the API/service boundaries listed above.

## Journey gates

| Gate                                           | Result | Evidence                                                    |
| ---------------------------------------------- | ------ | ----------------------------------------------------------- |
| Signed WhatsApp intake and normalization       | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Consent, language, quote, beneficiary          | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| KYC eligibility and phone binding              | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Same-key replay and conflicting-key rejection  | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Active-chat contention                         | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Collection, payout, ledger, reconciliation     | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Timeout, waiting, status-only query            | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Notification retry and failure isolation       | PASS   | Database journey assertion + worker notification tests      |
| Late/duplicate/out-of-order callback           | PASS   | API/service callback tests                                  |
| Support/admin masked investigation             | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |
| Manual payout recovery without automatic retry | PASS   | `local-e2e.customer-journey.integration.spec.ts`            |

Local E2E decision: `INCOMPLETE` until every gate has executable evidence and
the named reviewers sign the release record.
