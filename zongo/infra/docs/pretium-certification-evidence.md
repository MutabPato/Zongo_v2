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

## Repository boundary evidence

The repository tests cover the non-production adapter boundary in
`apps/api/src/pretium-webhook.controller.spec.ts`,
`libs/partner/src/lib/pretium-adapter.spec.ts`, and
`libs/partner/src/lib/pretium-webhook.service.spec.ts`: raw-body and signature
failure, normalized callback identity, CDF/KES request mapping, status lookup,
duplicate callbacks, out-of-order callbacks, and concurrent lifecycle updates.
These tests are implementation evidence only and do not replace account-
specific portal, live-rail, retry/rate-limit, or certification evidence.

Before enabling the partner module in the pilot deployment, run the
credential-redacting configuration check against the exact runtime:

```sh
pnpm verify:pretium-config
```

It requires HTTPS base and webhook URLs, runtime-only credentials, explicit
CDF/KES rail flags, and an explicit production/no-sandbox assertion. A passing
result proves configuration presence only; it does not prove that the webhook
URL is registered in the Pretium portal or replace live certification.

## Controlled test log

Every live test requires named operator, approved tiny amount, pre/post
reconciliation, active kill-switch confirmation, customer/accounting treatment,
and recovery result.

| Test                          | Operator | Pre-reconciliation | Result | Post-reconciliation | Evidence |
| ----------------------------- | -------- | ------------------ | ------ | ------------------- | -------- |
| Duplicate request             |          |                    |        |                     |          |
| Duplicate callback            |          |                    |        |                     |          |
| Out-of-order callback         |          |                    |        |                     |          |
| Replay                        |          |                    |        |                     |          |
| Authentication failure       |          |                    |        |                     |          |
| Timeout                      |          |                    |        |                     |          |
| Status lookup                 |          |                    |        |                     |          |
| Ambiguous result              |          |                    |        |                     |          |
| Terminal failure              |          |                    |        |                     |          |
| Manual recovery               |          |                    |        |                     |          |
| Reconciliation                |          |                    |        |                     |          |

Promotion decision: `NOT CERTIFIED` until account-specific terms and every test
are approved by Operations, Reconciliation, Compliance/Risk, and the accountable
pilot operator.

## Machine-checkable completeness check

Copy [`pretium-certification-evidence.example.json`](./pretium-certification-evidence.example.json)
to an access-controlled evidence location, replace every field with an
operator-owned evidence reference, and run:

```sh
PRETIUM_CERTIFICATION_EVIDENCE_PACK=/secure/evidence/pretium-certification.json \
  pnpm verify:pretium-certification
```

The verifier requires the masked account facts, all controlled live-test
records, named approvals including Pretium support/certification, and a
`CERTIFIED` promotion decision. It checks
completeness only; it never performs a live request, prints credentials, or
certifies the account itself.
