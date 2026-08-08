# Pretium CDF/KES Certification Evidence

Use only account-approved production validation. There is no sandbox assumption
for this pilot. Never place API keys, webhook secrets, or raw customer payloads
in this file.

## Account facts

- Account/merchant identifier (masked):
- CDF collection enabled evidence:
- KES disbursement enabled evidence:
- Portal webhook URL verification evidence:
- Webhook authentication contract:
- Idempotency contract:
- Status/retry/rate-limit contract:
- Support/escalation/retention terms:

## Controlled test log

Every live test requires named operator, approved tiny amount, pre/post
reconciliation, active kill-switch confirmation, customer/accounting treatment,
and recovery result.

| Test | Operator | Pre-reconciliation | Result | Post-reconciliation | Evidence |
| --- | --- | --- | --- | --- | --- |
| Duplicate request |  |  |  |  |  |
| Duplicate callback |  |  |  |  |  |
| Out-of-order callback |  |  |  |  |  |
| Replay/authentication failure |  |  |  |  |  |
| Timeout then status lookup |  |  |  |  |  |
| Ambiguous result |  |  |  |  |  |
| Terminal failure |  |  |  |  |  |
| Manual recovery |  |  |  |  |  |

Promotion decision: `NOT CERTIFIED` until account-specific terms and every test
are approved by Operations, Reconciliation, Compliance/Risk, and the accountable
pilot operator.
