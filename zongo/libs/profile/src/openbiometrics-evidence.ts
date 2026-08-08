export const OPEN_BIOMETRICS_SCENARIOS = [
  'DRC document types and quality variants',
  'French/Swahili/English operator and customer text',
  'Supported device and camera coverage',
  'Low-light and glare',
  'Low bandwidth and interrupted upload',
  'Face matching baseline and rejection',
  'Liveness baseline and rejection',
  'Print attack',
  'Screen replay',
  'Mask/occlusion',
  'Deepfake/replay attempt',
  'Demographic coverage',
  'Recovery/retry and human escalation',
] as const;

export const OPEN_BIOMETRICS_CONTRACTS = [
  'provider-neutral case states',
  'idempotency',
  'encrypted evidence',
  'independent review',
  'rejection/escalation',
  'expiry',
  'screening handoff',
  'retention',
  'restore-with-keys',
  'audit redaction',
] as const;

export const OPEN_BIOMETRICS_DECISIONS = [
  'Engineering',
  'Operations',
  'Compliance/Risk',
  'Reconciliation',
  'Accountable pilot operator',
] as const;

export const OPEN_BIOMETRICS_REQUIRED_PROMOTION_DECISION = 'PROMOTED';

const PROVENANCE_FIELDS = [
  'sourceRepositoryCommit',
  'dependencyLockfileHash',
  'modelFilesAndChecksums',
  'licenceReview',
  'sbom',
  'vulnerabilityScanAndExceptionOwner',
  'deploymentImageDigest',
  'supportOwnerAndEscalationPath',
] as const;

export type OpenBiometricsEvidencePack = {
  provenance?: Partial<Record<(typeof PROVENANCE_FIELDS)[number], string>>;
  scenarios?: Array<{
    name: string;
    result: 'PASS' | 'FAIL' | 'NOT_RUN';
    evidence?: string;
  }>;
  contracts?: Partial<
    Record<(typeof OPEN_BIOMETRICS_CONTRACTS)[number], string>
  >;
  decisions?: Partial<
    Record<(typeof OPEN_BIOMETRICS_DECISIONS)[number], string>
  >;
  promotionDecision?: string;
};

export type OpenBiometricsEvidenceCheck = {
  name: string;
  status: 'PASS' | 'FAIL';
  missing: string[];
};

export type OpenBiometricsEvidenceResult = {
  status: 'PASS' | 'INCOMPLETE';
  checks: OpenBiometricsEvidenceCheck[];
};

function present(value: unknown): boolean {
  return isUsableEvidenceReference(value);
}

export function verifyOpenBiometricsEvidence(
  pack: OpenBiometricsEvidencePack,
): OpenBiometricsEvidenceResult {
  const checks: OpenBiometricsEvidenceCheck[] = [];
  const provenance = pack.provenance ?? {};
  const contracts = pack.contracts ?? {};
  const decisions = pack.decisions ?? {};
  const scenarios = pack.scenarios ?? [];

  const missingProvenance = PROVENANCE_FIELDS.filter(
    (field) => !present(provenance[field]),
  );
  checks.push({
    name: 'build-and-provenance',
    status: missingProvenance.length ? 'FAIL' : 'PASS',
    missing: missingProvenance,
  });

  const missingScenarios = OPEN_BIOMETRICS_SCENARIOS.flatMap((name) => {
    const scenario = scenarios.find((entry) => entry.name === name);
    return !scenario ||
      scenario.result !== 'PASS' ||
      !present(scenario.evidence)
      ? [name]
      : [];
  });
  checks.push({
    name: 'scenario-matrix',
    status: missingScenarios.length ? 'FAIL' : 'PASS',
    missing: missingScenarios,
  });

  const missingContracts = OPEN_BIOMETRICS_CONTRACTS.filter(
    (contract) => !present(contracts[contract]),
  );
  checks.push({
    name: 'provider-neutral-contracts',
    status: missingContracts.length ? 'FAIL' : 'PASS',
    missing: missingContracts,
  });

  const missingDecisions = OPEN_BIOMETRICS_DECISIONS.filter(
    (decision) => !present(decisions[decision]),
  );
  checks.push({
    name: 'named-decisions',
    status: missingDecisions.length ? 'FAIL' : 'PASS',
    missing: missingDecisions,
  });

  const promotionRecorded =
    pack.promotionDecision === OPEN_BIOMETRICS_REQUIRED_PROMOTION_DECISION;
  checks.push({
    name: 'promotion-decision',
    status: promotionRecorded ? 'PASS' : 'FAIL',
    missing: promotionRecorded ? [] : ['promotionDecision'],
  });

  return {
    status: checks.every((check) => check.status === 'PASS')
      ? 'PASS'
      : 'INCOMPLETE',
    checks,
  };
}
import { isUsableEvidenceReference } from '@app/observability';
