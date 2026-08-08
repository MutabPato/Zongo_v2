# Pilot Operations Evidence Pack

Use the JSON template in this directory for the exact deployed commit and
configuration. Replace every empty field with an operator-owned evidence
reference and run:

```sh
OPERATIONS_EVIDENCE_PACK=/secure/evidence/operations.json \
  pnpm verify:operations-evidence
```

The verifier requires metrics, structured logs, trace correlation, warning and
urgent routing, acknowledgement/escalation, backup and restore evidence,
Postgres/Redis failure tests, approved positive RPO/RTO targets, and the pause,
incident, reconciliation, customer-impact, and controlled-resume exercise
references. It is read-only and cannot manufacture evidence or release the
pilot.
