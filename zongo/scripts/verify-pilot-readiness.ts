import { PrismaService } from '@app/db';
import {
  hashPilotReleasePublication,
  isUsableEvidenceReference,
  verifyPilotReleasePublicationSignature,
} from '@app/observability';

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
      include: {
        approvals: { orderBy: { approvedAt: 'asc' } },
        stageRecords: { orderBy: { recordedAt: 'asc' } },
      },
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
    const incompleteApprovals =
      record?.approvals.filter(
        (approval) => !approval.actorIdentityId.trim() || !approval.note.trim(),
      ).length ?? REQUIRED_APPROVALS.length;
    checks.push({
      name: 'substantive-pilot-approvals',
      status: incompleteApprovals ? 'FAIL' : 'PASS',
      details: { incomplete: incompleteApprovals },
    });

    const evidence = nonEmptyRecord(record?.evidenceRefs);
    const missingEvidence = REQUIRED_EVIDENCE.filter(
      (key) => !isUsableEvidenceReference(evidence[key]),
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

    const recomputedPublicationHash = record
      ? hashPilotReleasePublication({
          approvedCohort: record.approvedCohort,
          numericLimits: record.numericLimits,
          releaseConfiguration: record.releaseConfiguration,
          rollbackPlan: record.rollbackPlan ?? '',
          evidenceRefs: record.evidenceRefs,
          noWaiverConfirmed: record.noWaiverConfirmed,
          approvals: record.approvals
            .map((approval) => ({
              role: approval.role,
              actorIdentityId: approval.actorIdentityId,
              note: approval.note,
              approvedAt: approval.approvedAt.toISOString(),
            }))
            .sort((left, right) => left.role.localeCompare(right.role)),
          stageRecords: record.stageRecords
            .map((stageRecord) => ({
              id: stageRecord.id,
              stage: stageRecord.stage,
              evidenceRefs: stageRecord.evidenceRefs,
              approvedCohort: stageRecord.approvedCohort,
              numericLimits: stageRecord.numericLimits,
              releaseConfiguration: stageRecord.releaseConfiguration,
              rollbackPlan: stageRecord.rollbackPlan,
              noWaiverConfirmed: stageRecord.noWaiverConfirmed,
              recordedByIdentityId: stageRecord.recordedByIdentityId,
              recordedAt: stageRecord.recordedAt.toISOString(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          publishedAt: record.publishedAt?.toISOString(),
          publishedByIdentityId: record.publishedByIdentityId ?? undefined,
        })
      : null;
    const publicationHashMatches =
      Boolean(record?.publicationHash) &&
      record?.publicationHash === recomputedPublicationHash;
    const publicationSignatureValid =
      recomputedPublicationHash !== null &&
      verifyPilotReleasePublicationSignature(
        recomputedPublicationHash,
        record?.publicationSignature,
        process.env.PILOT_RELEASE_SIGNING_KEY,
      );
    const published = Boolean(
      record?.stage === 'PILOT_READY' &&
      record.noWaiverConfirmed &&
      record.publishedAt &&
      record.publishedByIdentityId &&
      publicationHashMatches &&
      publicationSignatureValid,
    );
    checks.push({
      name: 'pilot-ready-publication',
      status: published ? 'PASS' : 'FAIL',
      details: {
        published,
        publicationHash: record?.publicationHash ?? 'missing',
        publicationHashMatches,
        publicationSignatureValid,
      },
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
