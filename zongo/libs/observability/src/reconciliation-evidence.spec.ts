import {
  hasCompleteReconciliationCoverage,
  isHealthyReconciliationSweep,
} from './reconciliation-evidence';

describe('reconciliation coverage evidence', () => {
  it('passes only when every eligible transaction has a current result', () => {
    expect(
      hasCompleteReconciliationCoverage({
        eligibleTransactions: 2,
        reconciledTransactions: 2,
        staleTransactions: 0,
      }),
    ).toBe(true);
  });

  it('fails when a transaction is missing a non-pending result', () => {
    expect(
      hasCompleteReconciliationCoverage({
        eligibleTransactions: 2,
        reconciledTransactions: 1,
        staleTransactions: 0,
      }),
    ).toBe(false);
  });

  it('fails when the result is stale', () => {
    expect(
      hasCompleteReconciliationCoverage({
        eligibleTransactions: 1,
        reconciledTransactions: 1,
        staleTransactions: 1,
      }),
    ).toBe(false);
  });

  it('rejects sweeps with failed or skipped jobs', () => {
    expect(
      isHealthyReconciliationSweep({
        eligibleTransactions: 2,
        jobsObserved: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
      }),
    ).toBe(false);
    expect(
      isHealthyReconciliationSweep({
        eligibleTransactions: 2,
        jobsObserved: 2,
        succeeded: 1,
        failed: 0,
        skipped: 1,
      }),
    ).toBe(false);
  });
});
