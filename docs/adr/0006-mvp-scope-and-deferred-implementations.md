# ADR 0006: Limit MVP scope to DRC -> Kenya remittance and defer adjacent products

## Status
Accepted

## Context
The team is defining the first launch slice and needs to avoid scope drift that would blur the core corridor validation.

## Decision
The MVP scope is limited to the DRC -> Kenya corridor. Bill payments and the following corridors are explicitly deferred: KE -> DRC, DRC -> UG, and UG -> DRC.

## Consequences
- The team can focus on one corridor and one end-to-end transfer flow.
- Operational and compliance complexity stays bounded.
- Product and integration work for adjacent corridors remains out of scope until the core corridor is stable.

## Alternatives Considered
- Launch multiple corridors in the first release.
- Add bill payments in the first release.
- Build a corridor-agnostic product surface before proving the first route.

