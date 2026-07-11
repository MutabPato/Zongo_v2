# ADR 0003: Keep the user experience fiat-only

## Status
Accepted

## Context
The backend may use non-user-facing liquidity mechanisms, but the product needs to remain simple and trustworthy for users who expect fiat remittance behavior.

## Decision
The customer-facing experience will show only fiat amounts and transfer outcomes. Stablecoin or internal rail details will be hidden from the user flow.

## Consequences
- The UX stays simple and understandable.
- The product avoids exposing crypto semantics to users.
- Internal treasury or liquidity mechanisms can change without changing the customer model.
- Messaging, support, and compliance language stay aligned with fiat remittance.

## Alternatives Considered
- Expose stablecoin or internal rail mechanics to customers.
- Present the product as a crypto-enabled transfer flow.

