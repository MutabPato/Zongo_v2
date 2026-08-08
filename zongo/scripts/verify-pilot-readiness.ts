import { PrismaService } from '@app/db';
import { isUsableEvidenceReference } from '@app/observability';

const REQUIRED_APPROVALS = [
  'ENGINEERING',
  'OPERATIONS',
  'COMPLIANCE_RISK',
  'RECONCILIATION',
  'PILOT_OPERATOR',
] as const;
const REQUIRED_EVIDENCE = [
  'kyc',
  'provider',
  'security',
  'dpiaRetention',
  'reconciliation',
  'recovery',
  'observability',
  'incident',
  'customerJourney',
] as const;

type Check = {
  name: string;
  status: 'PASS' | 'FAIL';
  details: Record<string, string | number | boolean>;
};

function nonEmptyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasEntries(value: unknown): boolean {
  return Object.keys(nonEmptyRecord(value)).length > 0;
}

async function main(): Promise<void> {
  if (process.env.ALLOW_PILOT_READINESS_VERIFICATION !== 'true')
    throw new Error(
      'Set ALLOW_PILOT_READINESS_VERIFICATION=true to run the read-only readiness verification',
    );

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const checks: Check[] = [];
    const record = await prisma.pilotReleaseRecord.findUnique({
      where: { id: 'pilot' },
      include: { approvals: true, stageRecords: true },
    });
    const controls = await prisma.pilotControl.findMany({
      select: { key: true, state: true },
    });

    const stageHasEvidence = (stage: string) =>
      record?.stageRecords.some(
        (entry) =>
          entry.stage === stage &&
          Object.values(nonEmptyRecord(entry.evidenceRefs)).some(
            isUsableEvidenceReference,
          ),
      ) ?? false;
    checks.push({
      name: 'foundation-stage-recorded',
      status: stageHasEvidence('FOUNDATION_COMPLETE') ? 'PASS' : 'FAIL',
      details: { recorded: stageHasEvidence('FOUNDATION_COMPLETE') },
    });
    checks.push({
      name: 'local-e2e-stage-recorded',
      status: stageHasEvidence('LOCAL_E2E_COMPLETE') ? 'PASS' : 'FAIL',
      details: { recorded: stageHasEvidence('LOCAL_E2E_COMPLETE') },
    });

    const missingApprovals = REQUIRED_APPROVALS.filter(
      (role) => !record?.approvals.some((approval) => approval.role === role),
    );
    checks.push({
      name: 'named-pilot-approvals',
      status: missingApprovals.length ? 'FAIL' : 'PASS',
      details: {
        missing: missingApprovals.join(',') || 'none',
        count: REQUIRED_APPROVALS.length - missingApprovals.length,
      },
    });

    const evidence = nonEmptyRecord(record?.evidenceRefs);
    const missingEvidence = REQUIRED_EVIDENCE.filter(
      (key) =>
        !isUsableEvidenceReference(evidence[key]),
    );
    checks.push({
      name: 'pilot-evidence-references',
      status: missingEvidence.length ? 'FAIL' : 'PASS',
      details: {
        missing: missingEvidence.join(',') || 'none',
        count: REQUIRED_EVIDENCE.length - missingEvidence.length,
      },
    });

    const releaseFactsPresent = Boolean(
      hasEntries(record?.approvedCohort) &&
        hasEntries(record?.numericLimits) &&
        hasEntries(record?.releaseConfiguration) &&
        record?.rollbackPlan?.trim(),
    );
    checks.push({
      name: 'release-facts-and-rollback',
      status: releaseFactsPresent ? 'PASS' : 'FAIL',
      details: { present: releaseFactsPresent },
    });

    const controlsReady = [
      'GLOBAL',
      'INITIATION',
      'COLLECTION',
      'PAYOUT',
      'CORRIDOR_PROVIDER',
      'NOTIFICATION',
    ].every((key) =>
      controls.some(
        (control) => control.key === key && control.state === 'ENABLED',
      ),
    );
    checks.push({
      name: 'all-pilot-controls-explicit',
      status: controlsReady ? 'PASS' : 'FAIL',
      details: { configured: controls.length },
    });

    const published = Boolean(
      record?.stage === 'PILOT_READY' &&
      record.noWaiverConfirmed &&
      record.publishedAt,
    );
    checks.push({
      name: 'pilot-ready-publication',
      status: published ? 'PASS' : 'FAIL',
      details: { published },
    });

    const passed = checks.every((check) => check.status === 'PASS');
    console.log(
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          status: passed ? 'PASS' : 'FAIL',
          checks,
          note: 'Read-only evidence verification; this command cannot start, resume, or approve real-money movement.',
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
    error instanceof Error ? error.message : 'Readiness verification failed',
  );
  process.exitCode = 1;
});
