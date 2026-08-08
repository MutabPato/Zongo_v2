# Pilot Backup and Restore Runbook

The deployment owner must fill the approved RPO/RTO values before Pilot Ready.
The values are configuration/evidence inputs and are intentionally not invented
by this repository.

## Backup scope

- PostgreSQL data, migrations, audit events, worker jobs, reconciliation,
  control state, and Admin sessions as defined by the approved retention policy.
- Critical configuration metadata and key-version identifiers; secret values
  remain in the approved secret manager.
- Redis is disposable coordination state and is not the business backup.

## Restore proof

1. Restore a copy into an isolated database.
2. Restore the exact encryption-key versions required by ciphertext rows.
3. Run Prisma migrations and integrity checks.
4. Verify ciphertext decrypts, blind-index lookups work, audit rows remain
   append-only, worker leases can be reclaimed, and control state is preserved.
5. Rebuild Redis from durable sessions/jobs/rate-limit facts.
6. Run integration tests, reconciliation, and a controlled status-only check.
7. Record backup timestamp, restore timestamp, RPO/RTO result, key versions,
   row-count checks, discrepancies, and approver.

Never restore production data into a developer environment without approved
access controls and a documented deletion/legal-hold decision.

## Key lifecycle evidence

Run the read-only configuration check against the exact deployment environment:

```sh
ALLOW_KEY_LIFECYCLE_VERIFICATION=true pnpm verify:key-lifecycle
```

The check verifies that each configured purpose has a current non-retired
version, retained versions required for decryption, a blind-index key, and
distinct key material. It never prints key values. The result is configuration
evidence only; managed secret-manager separation, rotation execution,
compromise response, and access-audit approval remain required release evidence.

Run the restore verifier against the isolated restored database and restored key
set:

```sh
ALLOW_RESTORE_VERIFICATION=true \
  REDIS_REBUILD_EVIDENCE_REF='evidence://restore/redis-rebuild-<run-id>' \
  PILOT_RPO_MINUTES='<approved-rpo>' \
  PILOT_RTO_MINUTES='<approved-rto>' \
  pnpm verify:restore
```

It samples sender, beneficiary payout, KYC, session, inbound-event, and
notification ciphertext domains when present, checks keyed-index consistency,
and reports durable inputs available for Redis reconstruction. The Redis
reference must point to an actual restore exercise; setting it does not itself
perform the rebuild. The RPO/RTO values must be the approved targets for the
exact pilot deployment, not estimates inferred from this repository.

## Legacy sensitive-data migration

Legacy sender contacts, beneficiary payout phone/account JSON, verification
phones, and provider references are migrated only through the explicitly gated
command below. It encrypts recoverable values, creates keyed lookup indexes,
and clears legacy plaintext columns where the encrypted replacement is written:

```sh
ALLOW_SENSITIVE_INDEX_BACKFILL=true pnpm backfill:sensitive-blind-indexes
```

Run it only with the approved key set and an auditable backup/rollback plan;
the opt-in is intentionally absent from normal startup and deployment.
