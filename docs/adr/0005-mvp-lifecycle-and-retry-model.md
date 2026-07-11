# ADR 0005: Use strict 15-minute lifecycle timeouts and manual-only payout retries

## Status
Accepted

## Context
The MVP has asynchronous partner callbacks, but the product needs clear finality rules so unresolved transactions do not hang indefinitely in chat or in ops tooling.

## Decision
The MVP will use a 15-minute timeout for both collection and payout. If collection or payout is not completed in time, the transaction transitions to `COLLECTION_FAILED` or `PAYOUT_FAILED` respectively. Late success events are audit-only and must not change transaction state. Payout retries are manual only and happen on the same transaction record.

## Consequences
- The lifecycle is predictable and easy to support.
- Closed transactions remain closed, which simplifies reconciliation.
- Ops retains explicit control over failed payouts.
- Late partner callbacks can be kept for audit without mutating business state.

## Alternatives Considered
- Keep pending transactions open indefinitely.
- Allow late callbacks to reopen completed or failed transactions.
- Use automatic payout retries.
- Use different timeout values for collection and payout.

