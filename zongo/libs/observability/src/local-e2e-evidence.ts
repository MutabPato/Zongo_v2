import { isUsableEvidenceReference } from './pilot-evidence';

export const LOCAL_E2E_GATES = [
  'signedIntake',
  'consentAndBeneficiary',
  'kycEligibility',
  'idempotency',
  'activeChatContention',
  'moneyMovementAndReconciliation',
  'timeoutAndStatusOnly',
  'notificationFailureIsolation',
  'callbackOrderingAndReplay',
  'supportInvestigation',
  'manualPayoutRecovery',
] as const;

export type LocalE2eEvidencePack = {
  commitOrImageDigest?: string;
  schemaHash?: string;
  executedAt?: string;
  suitesPassed?: number;
  testsPassed?: number;
  workerStoppedDuringRun?: boolean;
  workerRunningAfterRun?: boolean;
  postgresHealthy?: boolean;
  redisHealthy?: boolean;
  controlledPartner?: boolean;
  productionCredentialsUsed?: boolean;
  externalNotificationsUsed?: boolean;
  gateEvidence?: Partial<Record<(typeof LOCAL_E2E_GATES)[number], string>>;
};

export type LocalE2eEvidenceResult = {
  status: 'PASS' | 'INCOMPLETE';
  missing: string[];
};

function isCommitOrDigest(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (/^[0-9a-f]{40}$/i.test(value.trim()) ||
      /^sha256:[0-9a-f]{64}$/i.test(value.trim()))
  );
}

function isSchemaHash(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value.trim());
}

function isIsoTimestamp(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    value.includes('T')
  );
}

/** Verifies only the completeness of a controlled Local E2E evidence artifact. */
export function verifyLocalE2eEvidence(
  pack: LocalE2eEvidencePack,
): LocalE2eEvidenceResult {
  const missing: string[] = [];
  if (!isCommitOrDigest(pack.commitOrImageDigest))
    missing.push('commitOrImageDigest');
  if (!isSchemaHash(pack.schemaHash)) missing.push('schemaHash');
  if (!isIsoTimestamp(pack.executedAt)) missing.push('executedAt');
  if (!Number.isInteger(pack.suitesPassed) || (pack.suitesPassed ?? 0) <= 0)
    missing.push('suitesPassed');
  if (!Number.isInteger(pack.testsPassed) || (pack.testsPassed ?? 0) <= 0)
    missing.push('testsPassed');
  for (const [name, value] of [
    ['workerStoppedDuringRun', pack.workerStoppedDuringRun],
    ['workerRunningAfterRun', pack.workerRunningAfterRun],
    ['postgresHealthy', pack.postgresHealthy],
    ['redisHealthy', pack.redisHealthy],
    ['controlledPartner', pack.controlledPartner],
  ] as const) {
    if (value !== true) missing.push(name);
  }
  if (pack.productionCredentialsUsed !== false)
    missing.push('productionCredentialsUsed');
  if (pack.externalNotificationsUsed !== false)
    missing.push('externalNotificationsUsed');
  for (const gate of LOCAL_E2E_GATES) {
    if (!isUsableEvidenceReference(pack.gateEvidence?.[gate]))
      missing.push(`gateEvidence.${gate}`);
  }
  return {
    status: missing.length === 0 ? 'PASS' : 'INCOMPLETE',
    missing,
  };
}
