# Local E2E Evidence Record

Record the exact commit, configuration, database migration state, controlled
partner behavior, and evidence links. Passing unit tests alone is insufficient.

- Commit/image digest:
- Environment and migration hash:
- Partner stub/cassette:
- Evidence directory:

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

The record remains `INCOMPLETE` until notification retry/failure isolation,
full callback ordering/replay coverage, and the remaining named operational
gates have their own executable evidence.

## Journey gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Signed WhatsApp intake and normalization |  |  |
| Consent, language, quote, beneficiary |  |  |
| KYC eligibility and phone binding |  |  |
| Same-key replay and conflicting-key rejection |  |  |
| Active-chat contention |  |  |
| Collection, payout, ledger, reconciliation |  |  |
| Timeout, waiting, status-only query |  |  |
| Notification retry and failure isolation |  |  |
| Late/duplicate/out-of-order callback |  |  |
| Support/admin masked investigation |  |  |
| Manual payout recovery without automatic retry |  |  |

Local E2E decision: `INCOMPLETE` until every gate has executable evidence and
the named reviewers sign the release record.
