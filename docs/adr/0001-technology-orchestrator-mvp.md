# ADR 0001: Launch the MVP as a technology orchestrator

## Status
Accepted

## Context
The product targets a remittance corridor that depends on licensed financial infrastructure in the DRC and Kenya. The team wants to launch quickly, avoid holding customer funds, and reduce the regulatory burden of becoming a money transmitter on day one.

## Decision
The MVP will operate as a technology orchestrator. It will capture user intent, perform product-level checks, and coordinate licensed partners to execute collection and payout. It will not be the regulated money transmitter of record.

## Consequences
- The product can launch faster with lower capital requirements.
- Compliance and settlement execution remain with licensed partners.
- The platform must keep a clean legal and operational boundary between orchestration and funds movement.
- Partner dependency becomes a core operational risk.

## Alternatives Considered
- Become a licensed remittance operator from the start.
- Act as a direct money transmitter with owned settlement rails.

