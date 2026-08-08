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

export function verifyOperationsEvidence(
  pack: OperationsEvidencePack,
): OperationsEvidenceResult {
  const missing = OPERATIONS_EVIDENCE_FIELDS.filter((field) => {
    const value = pack[field];
    if (field === 'approvedRpoMinutes' || field === 'approvedRtoMinutes') {
      const numeric = typeof value === 'number' ? value : Number(value);
      return !Number.isInteger(numeric) || numeric <= 0;
    }
    return !isUsableEvidenceReference(value);
  });
  return {
    status: missing.length === 0 ? 'PASS' : 'INCOMPLETE',
    missing,
  };
}
