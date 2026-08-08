# DRC-to-Kenya Pilot Operations Runbook

This runbook is an execution template, not a release approval. A missing
required evidence item is a stop condition; no waiver can promote the pilot.

## Authority

| Action | Authority | Required evidence |
| --- | --- | --- |
| Start or permanently stop | Accountable pilot operator identified by `PILOT_OPERATOR_ID` | Signed release/stop record and reconciliation snapshot |
| Pause or resume within the approved runbook | Ops | Incident or resume record, control state, queued-job review |
| Technical isolation/recommendation | Engineering | Isolation reason and handoff to Ops/operator |
| Customer communication/investigation | Support | Case notes; no money-moving mutation |
| Access and policy administration | Admin | MFA, role audit; no pilot release authority |

## Pause sequence

1. Ops pauses the narrowest affected control (`INITIATION`, `COLLECTION`,
   `PAYOUT`, `CORRIDOR_PROVIDER`, `NOTIFICATION`, or `GLOBAL`) with a reason.
2. Confirm the control row and audit event are durable in Postgres.
3. Confirm no new transfer, collection, payout, or notification job can claim
   money movement while paused. Status checks, reconciliation, audit, support,
   and manual payout recovery remain available.
4. Record pending, ambiguous, partner-settlement, and recovery exposure.
5. Notify the accountable operator, reconciliation owner, and affected
   customers through the approved channel.

## Resume sequence

Resume requires all of: root cause recorded, provider/dependency health
verified, queued-job review complete, customer-impact review complete,
reconciliation current, exposure below approved limits, secrets/keys available,
and an Ops/operator approval recorded against the same incident.

## Postgres and Redis failure

Postgres unavailable: reject new transfer state, partner calls, lifecycle
mutation, and job claims. Redis unavailable: rebuild disposable locks,
wakeups, and rate-limit state from durable facts; keep Postgres-backed work
running only when ingress throttling can be proven conservatively.

## Evidence fields

Every pause/resume record includes incident ID, actor identity, control key,
old/new state, reason, UTC timestamps, pending/ambiguous exposure, reconciliation
reference, customer-impact decision, queued-job decision, and next review time.
