# OpenBiometrics Pilot Evidence Pack

This is a controlled evidence template. It does not claim that OpenBiometrics
has passed any gate until each result is attached and independently approved.

The machine-checkable form is [`openbiometrics-evidence-pack.example.json`](./openbiometrics-evidence-pack.example.json).
Copy it to a controlled evidence location, replace every placeholder with an
operator-owned evidence reference, and run:

```sh
OPENBIOMETRICS_EVIDENCE_PACK=/secure/evidence/openbiometrics.json \
  pnpm verify:openbiometrics-evidence
```

The verifier is read-only. It reports `INCOMPLETE` unless all provenance
fields, scenario results and evidence links, provider-neutral contracts, named
decisions, and an affirmative `PROMOTED` decision are present. It does not execute biometric
matching or liveness tests and does not manufacture a vendor, model, license,
security, demographic, or certification result.

## Build and provenance

- Source repository/commit:
- Dependency lockfile hash:
- Model files and checksums:
- Licence review:
- SBOM:
- Vulnerability scan and exception owner:
- Deployment image digest:
- Support owner and escalation path:

## Scenario matrix

Record input fixture ID, device/OS/browser, network profile, language, result,
latency, retry count, reviewer, and evidence link for each row.

| Scenario                                          | Result | Evidence |
| ------------------------------------------------- | ------ | -------- |
| DRC document types and quality variants           |        |          |
| French/Swahili/English operator and customer text |        |          |
| Supported device and camera coverage              |        |          |
| Low-light and glare                               |        |          |
| Low bandwidth and interrupted upload              |        |          |
| Face matching baseline and rejection              |        |          |
| Liveness baseline and rejection                   |        |          |
| Print attack                                      |        |          |
| Screen replay                                     |        |          |
| Mask/occlusion                                    |        |          |
| Deepfake/replay attempt                           |        |          |
| Demographic coverage                              |        |          |
| Recovery/retry and human escalation               |        |          |

## Contract evidence

Attach tests for provider-neutral case states, idempotency, encrypted evidence,
independent review, rejection/escalation, expiry, screening handoff, retention,
restore-with-keys, and audit redaction. Technical match/liveness output alone
cannot approve a sender.

## Named decisions

Engineering:  
Operations:  
Compliance/Risk:  
Reconciliation:  
Accountable pilot operator:

Promotion decision: `NOT PROMOTED` until every named decision and scenario gate
is complete.
