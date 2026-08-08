import { DomainError } from './domain-error';
import { TransferLifecyclePolicy } from './transfer-lifecycle-policy';

describe('TransferLifecyclePolicy', () => {
  it('rejects resurrection of a terminal transfer', () => {
    const policy = new TransferLifecyclePolicy();
    let thrown: unknown;

    try {
      policy.assertTransition('PAYOUT_FAILED', 'PAYOUT_SUCCESS');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    if (!(thrown instanceof DomainError)) throw thrown;
    expect(thrown.code).toBe('INVALID_TRANSACTION_TRANSITION');
  });

  it('allows a failed payout to re-enter payout only through a manual retry', () => {
    const policy = new TransferLifecyclePolicy();

    expect(() =>
      policy.assertTransition('PAYOUT_FAILED', 'PENDING_PAYOUT'),
    ).toThrow(DomainError);
    expect(() =>
      policy.assertTransition('PAYOUT_FAILED', 'PENDING_PAYOUT', {
        reason: 'MANUAL_PAYOUT_RETRY',
      }),
    ).not.toThrow();
  });
});
