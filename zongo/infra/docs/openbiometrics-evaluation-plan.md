# OpenBiometrics Pilot Evaluation Baseline

This document records the candidate baseline for issue 12. It is an
evaluation plan, not a claim that the POC has passed or that the pilot is
approved.

## Candidate under evaluation

- Source: <https://github.com/openbm/openbiometrics>
- Official documentation: <https://docs.openbiometrics.dev/>
- Self-hosting instructions: <https://docs.openbiometrics.dev/self-hosting/docker/>
- Candidate version: `0.3.0`, subject to pinning the exact source commit before
  execution.
- Deployment baseline: CPU-only Docker deployment in an isolated environment;
  no cloud API key or production identity data.
- Candidate modules: document processing, face verification, passive/active
  liveness, and signed event/webhook handling.
- Repository transport boundary: `libs/profile/src/openbiometrics-client.ts`
  supports self-hosted multipart detection, document scan, face verification,
  and liveness-session calls. It is transport-only and cannot promote a
  sender or bypass human review.
- Case orchestration boundary: `libs/profile/src/openbiometrics-verification.service.ts`
  maps successful checks to `HUMAN_REVIEW` and failures to
  `TECHNICAL_REVIEW`; it persists only redacted check summaries.

The project documentation identifies the community model tier as the default
and lists YuNet, SFace, MiniFASNet, Face Mesh, and document-processing models
with stated licenses. The exact downloaded model files, checksums, dependency
lockfile, SBOM, vulnerability report, and license review must be captured in
the evidence pack before any promotion decision.

## Required execution evidence

The POC operator must record the exact source commit, container digest, model
checksums, hardware/OS, runtime configuration, and named support owner. No
production customer or identity-document data may be used.

The scenario set must cover:

- DRC identity-document types, OCR/MRZ fields, French/English/Swahili
  language handling, and exact document-quality failures;
- supported Android/iOS devices, camera permissions, low light, glare,
  blur, low bandwidth, interrupted capture, retry, and offline recovery;
- genuine match/rejection, print, replayed screen, mask, deepfake, and
  demographic-disaggregated liveness/face-match outcomes;
- provider-neutral verification-case mapping, signed callback authentication,
  idempotency, independent human review, screening handoff, retention,
  encrypted evidence storage, restore-with-keys, and audit redaction.

The result must be entered into
[`openbiometrics-evidence-pack.example.json`](./openbiometrics-evidence-pack.example.json)
and pass `pnpm verify:openbiometrics-evidence`. The verifier only checks
completeness; it cannot manufacture biometric test results or promotion
decisions. A named Engineering, Operations, Compliance/Risk, Reconciliation,
and accountable pilot-operator decision is still required.

## Current decision

`NOT PROMOTED` — candidate baseline recorded; exact source pin, execution
results, security/licence review, and named decisions are outstanding.
