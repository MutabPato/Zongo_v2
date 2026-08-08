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
