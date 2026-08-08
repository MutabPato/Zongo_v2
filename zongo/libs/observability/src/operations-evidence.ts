import { isUsableEvidenceReference } from './pilot-evidence';

export const OPERATIONS_EVIDENCE_FIELDS = [
  'deploymentCommitOrImageDigest',
  'metricsEvidence',
  'structuredLogsEvidence',
  'traceCorrelationEvidence',
  'warningRoutingEvidence',
  'urgentRoutingEvidence',
  'acknowledgementAndEscalationEvidence',
  'postgresBackupEvidence',
  'criticalConfigurationBackupEvidence',
  'restoreWithKeysEvidence',
  'redisLossRebuildEvidence',
  'postgresFailureEvidence',
  'approvedRpoMinutes',
  'approvedRtoMinutes',
  'pauseExerciseEvidence',
  'incidentCommunicationEvidence',
  'reconciliationExerciseEvidence',
  'customerImpactEvidence',
  'controlledResumeEvidence',
] as const;

export type OperationsEvidencePack = Partial<
  Record<(typeof OPERATIONS_EVIDENCE_FIELDS)[number], string | number>
>;

export type OperationsEvidenceResult = {
  status: 'PASS' | 'INCOMPLETE';
  missing: string[];
};

function isDeploymentIdentity(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (/^[0-9a-f]{40}$/i.test(value.trim()) ||
      /^sha256:[0-9a-f]{64}$/i.test(value.trim()))
  );
}

export function verifyOperationsEvidence(
  pack: OperationsEvidencePack,
): OperationsEvidenceResult {
  const missing = OPERATIONS_EVIDENCE_FIELDS.filter((field) => {
    const value = pack[field];
    if (field === 'approvedRpoMinutes' || field === 'approvedRtoMinutes') {
      const numeric = typeof value === 'number' ? value : Number(value);
      return !Number.isInteger(numeric) || numeric <= 0;
    }
    if (field === 'deploymentCommitOrImageDigest')
      return !isDeploymentIdentity(value);
    return !isUsableEvidenceReference(value);
  });
  return {
    status: missing.length === 0 ? 'PASS' : 'INCOMPLETE',
    missing,
  };
}
