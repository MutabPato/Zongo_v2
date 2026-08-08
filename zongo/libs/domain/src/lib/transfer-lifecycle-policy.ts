import { DomainError } from './domain-error';
import type { TransferStatus } from './transfer-transaction';

const ALLOWED_TRANSITIONS: Readonly<
  Record<TransferStatus, readonly TransferStatus[]>
> = {
  INITIATED: ['PENDING_COLLECTION'],
  PENDING_COLLECTION: ['COLLECTION_SUCCESS', 'COLLECTION_FAILED'],
  COLLECTION_SUCCESS: ['PENDING_PAYOUT'],
  COLLECTION_FAILED: [],
  PENDING_PAYOUT: ['PAYOUT_SUCCESS', 'PAYOUT_FAILED'],
  PAYOUT_SUCCESS: [],
  PAYOUT_FAILED: [],
};

export class TransferLifecyclePolicy {
  assertTransition(
    from: TransferStatus,
    to: TransferStatus,
    context?: { reason: 'MANUAL_PAYOUT_RETRY' },
  ): void {
    if (from === to) return;
    if (ALLOWED_TRANSITIONS[from].includes(to)) return;
    if (
      from === 'PAYOUT_FAILED' &&
      to === 'PENDING_PAYOUT' &&
      context?.reason === 'MANUAL_PAYOUT_RETRY'
    )
      return;

    throw new DomainError(
      'INVALID_TRANSACTION_TRANSITION',
      `Transfer cannot transition from ${from} to ${to}`,
    );
  }
}
