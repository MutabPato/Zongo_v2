export type ReconciliationCoverageCounts = {
  eligibleTransactions: number;
  reconciledTransactions: number;
  staleTransactions: number;
};

export type ReconciliationSweepSummary = {
  eligibleTransactions: number;
  jobsObserved: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/** A transaction is covered only by a current, non-pending reconciliation. */
export function hasCompleteReconciliationCoverage(
  counts: ReconciliationCoverageCounts,
): boolean {
  return (
    counts.eligibleTransactions === counts.reconciledTransactions &&
    counts.staleTransactions === 0
  );
}

/** A sweep is healthy only when every observed job completed successfully. */
export function isHealthyReconciliationSweep(
  summary: ReconciliationSweepSummary,
): boolean {
  return (
    summary.eligibleTransactions >= 0 &&
    summary.jobsObserved >= 0 &&
    summary.succeeded === summary.jobsObserved &&
    summary.failed === 0 &&
    summary.skipped === 0
  );
}
