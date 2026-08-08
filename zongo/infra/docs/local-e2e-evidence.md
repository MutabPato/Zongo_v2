# Local E2E Evidence Record

Record the exact commit, configuration, database migration state, controlled
partner behavior, and evidence links. Passing unit tests alone is insufficient.

- Commit/image digest: `1cd95a558ae8f808fb6a25100d1c4975581112a1`
- Environment and migration hash: local PostgreSQL/Redis; Prisma schema
  `c2a4750988111593bd58c3d8cc985de8214b896bd3db68858b901db5e30be7b0`
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

- Commit: `1cd95a558ae8f808fb6a25100d1c4975581112a1`
- Prisma schema hash: `c2a4750988111593bd58c3d8cc985de8214b896bd3db68858b901db5e30be7b0`
- Executed at: `2026-08-08T22:47:10Z`
- Command: `DATABASE_URL='<local-only PostgreSQL URL>' pnpm test:integration`
- Worker state during test: stopped; PostgreSQL and Redis healthy
- Result: `2` suites passed, `3` tests passed
- Worker state after test: running; no production partner credentials or
  external customer notifications used

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
| Signed WhatsApp intake and normalization       |        |                                                             |
| Consent, language, quote, beneficiary          |        |                                                             |
| KYC eligibility and phone binding              |        |                                                             |
| Same-key replay and conflicting-key rejection  |        |                                                             |
| Active-chat contention                         |        |                                                             |
| Collection, payout, ledger, reconciliation     |        |                                                             |
| Timeout, waiting, status-only query            |        |                                                             |
| Notification retry and failure isolation       |        | Database journey failure-isolation assertion + worker tests |
| Late/duplicate/out-of-order callback           |        | API/service callback tests                                  |
| Support/admin masked investigation             |        |                                                             |
| Manual payout recovery without automatic retry |        |                                                             |

Local E2E decision: `INCOMPLETE` until every gate has executable evidence and
the named reviewers sign the release record.
