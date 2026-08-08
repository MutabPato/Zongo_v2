import { PrismaService } from '@app/db';

const RECONCILABLE_STATUSES = [
  'COLLECTION_SUCCESS',
  'PENDING_PAYOUT',
  'PAYOUT_SUCCESS',
  'COLLECTION_FAILED',
  'PAYOUT_FAILED',
] as const;
const DISCREPANCY_STATUSES = [
  'MISMATCH',
  'MISSING_COLLECTION_ENTRY',
  'MISSING_PAYOUT_ENTRY',
] as const;

type Check = {
  name: string;
  status: 'PASS' | 'FAIL';
  details: Record<string, string | number | boolean>;
};

async function main(): Promise<void> {
  if (process.env.ALLOW_RECONCILIATION_VERIFICATION !== 'true')
    throw new Error(
      'Set ALLOW_RECONCILIATION_VERIFICATION=true to run the read-only reconciliation verification',
    );

  const maxAgeMs = Number(
    process.env.RECONCILIATION_EVIDENCE_MAX_AGE_MS ?? 24 * 60 * 60 * 1000,
  );
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    throw new Error('RECONCILIATION_EVIDENCE_MAX_AGE_MS must be positive');

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const checks: Check[] = [];
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'postgres-connectivity', status: 'PASS', details: {} });

    const cutoff = new Date(Date.now() - maxAgeMs);
    const [eligibleTransactions, reconciledTransactions, staleTransactions] =
      await Promise.all([
        prisma.transferTransaction.count({
          where: { status: { in: [...RECONCILABLE_STATUSES] } },
        }),
        prisma.transactionReconciliation.count({
          where: {
            transaction: { status: { in: [...RECONCILABLE_STATUSES] } },
          },
        }),
        prisma.transactionReconciliation.count({
          where: {
            checkedAt: { lt: cutoff },
            transaction: { status: { in: [...RECONCILABLE_STATUSES] } },
          },
        }),
      ]);
    const coverageComplete =
      eligibleTransactions === reconciledTransactions &&
      staleTransactions === 0;
    checks.push({
      name: 'reconciliation-cadence-and-coverage',
      status: coverageComplete ? 'PASS' : 'FAIL',
      details: {
        eligibleTransactions,
        reconciledTransactions,
        staleTransactions,
        maxAgeMs,
      },
    });

    const unresolvedDiscrepancies =
      await prisma.transactionReconciliation.count({
        where: {
          status: { in: [...DISCREPANCY_STATUSES] },
          OR: [{ discrepancyOwnerIdentityId: null }, { escalatedAt: null }],
        },
      });
    checks.push({
      name: 'discrepancy-ownership-and-escalation',
      status: unresolvedDiscrepancies === 0 ? 'PASS' : 'FAIL',
      details: { unresolvedDiscrepancies },
    });

    const [controlDecisionEvents, readinessPublicationEvents, completedSweeps] =
      await Promise.all([
        prisma.auditEvent.count({
          where: { name: { startsWith: 'admin.pilot-control.' } },
        }),
        prisma.auditEvent.count({
          where: { name: 'admin.pilot-readiness.published' },
        }),
        prisma.auditEvent.count({
          where: { name: 'reconciliation.sweep.completed' },
        }),
      ]);
    const decisionHistoryComplete =
      controlDecisionEvents > 0 &&
      readinessPublicationEvents > 0 &&
      completedSweeps > 0;
    checks.push({
      name: 'release-and-control-decision-history',
      status: decisionHistoryComplete ? 'PASS' : 'FAIL',
      details: {
        controlDecisionEvents,
        readinessPublicationEvents,
        completedSweeps,
      },
    });

    const passed = checks.every((check) => check.status === 'PASS');
    console.log(
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          status: passed ? 'PASS' : 'FAIL',
          checks,
          note: 'Read-only reconciliation evidence verification; this command cannot release, resume, mutate, or settle transfers.',
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Reconciliation verification failed',
  );
  process.exitCode = 1;
});
