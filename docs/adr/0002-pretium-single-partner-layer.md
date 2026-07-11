# ADR 0002: Use Pretium as the single partner layer for MVP collection and payout

## Status
Accepted

## Context
The MVP needs one partner abstraction for both sides of the transfer so the team can validate the corridor without managing separate collection and payout integrations.

## Decision
Pretium will be the single integration partner for the MVP. The product will route both collection and payout through Pretium instead of integrating multiple providers for the first release.

## Consequences
- The integration surface is smaller and easier to test.
- The product is dependent on one partner for end-to-end availability.
- Operational complexity is reduced early, but partner lock-in increases.
- Future rail expansion will require a deliberate migration plan.

## Alternatives Considered
- Integrate separate collection and payout providers.
- Use M-Pesa and TerraPay directly.
- Build a multi-partner routing layer from the start.

