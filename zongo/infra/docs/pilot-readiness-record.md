# Pilot Readiness Record

This record separates implementation evidence from release authority. It must
be completed for the exact deployed commit and configuration.

## Readiness states

- `Foundation Complete`: durable application, security, provider, KYC review,
  operations, and recovery controls pass their executable gates.
- `Local E2E Complete`: the complete controlled customer journey passes through
  real application boundaries with controlled partner behavior.
- `Pilot Ready`: all material provider, KYC, DPIA/retention, reconciliation,
  restore, incident, and named-approval evidence is attached. No waiver applies.

## Required approval record

| Role                       | Name/identity | Decision | Timestamp | Evidence link |
| -------------------------- | ------------- | -------- | --------- | ------------- |
| Engineering                |               |          |           |               |
| Operations                 |               |          |           |               |
| Compliance/Risk            |               |          |           |               |
| Reconciliation             |               |          |           |               |
| Accountable pilot operator |               |          |           |               |

## Release facts

- Commit/image digest:
- Approved cohort/allowlist evidence:
- Numeric exposure limits:
- Active control states:
- Pretium CDF/KES account certification evidence:
- OpenBiometrics/fallback evidence:
- DPIA, retention, cross-border, and processor evidence:
- Backup/restore and RPO/RTO evidence:
- Incident, pause/resume, and rollback references:
- Start, pause/resume, permanent-stop, and release-evidence runbook references:
- Explicit no-waiver declaration:
- Release publication fingerprint and signature: generated with the
  runtime-only `PILOT_RELEASE_SIGNING_KEY`; the key is never stored in the
  release record or audit payload.

An empty field or unresolved material issue means `Pilot Ready: NO`.

Run the read-only executable check with:

```sh
ALLOW_PILOT_READINESS_VERIFICATION=true pnpm verify:pilot-readiness
```

The command reports missing stage snapshots, named approvals, evidence
references, release facts, explicit control rows, a valid publication
fingerprint/signature, exact Pretium runtime configuration, or key-lifecycle
and release-signing configuration. It never starts, resumes, or approves
real-money movement.
