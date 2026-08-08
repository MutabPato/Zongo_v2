import { isUsableEvidenceReference } from '@app/observability';

export const PRETIUM_LIVE_TESTS = [
  'duplicateRequest',
  'duplicateCallback',
  'outOfOrderCallback',
  'replay',
  'authenticationFailure',
  'timeout',
  'statusLookup',
  'ambiguousResult',
  'terminalFailure',
  'manualRecovery',
  'reconciliation',
] as const;

export type PretiumLiveTest = (typeof PRETIUM_LIVE_TESTS)[number];

export type PretiumCertificationTest = {
  operator: string;
  approvedTinyAmountEvidence: string;
  preReconciliation: string;
  result: string;
  postReconciliation: string;
  killSwitchEvidence: string;
  customerAccountingTreatment: string;
  recoveryResult: string;
  evidence: string;
};

export type PretiumCertificationEvidencePack = {
  account: {
    merchantIdentifier: string;
    cdfEnabledEvidence: string;
    kesEnabledEvidence: string;
    portalWebhookEvidence: string;
    webhookAuthenticationContract: string;
    idempotencyContract: string;
    statusRetryRateLimitContract: string;
    supportEscalationRetentionTerms: string;
  };
  tests: Partial<Record<PretiumLiveTest, PretiumCertificationTest>>;
  approvals: {
    operations: string;
    reconciliation: string;
    complianceRisk: string;
    pilotOperator: string;
    pretiumSupportCertification: string;
  };
  promotionDecision: 'CERTIFIED' | 'NOT_CERTIFIED';
  promotionDecisionEvidence: string;
};

export type PretiumCertificationEvidenceResult = {
  status: 'PASS' | 'INCOMPLETE';
  missing: string[];
};

const ACCOUNT_FIELDS: Array<keyof PretiumCertificationEvidencePack['account']> =
  [
    'merchantIdentifier',
    'cdfEnabledEvidence',
    'kesEnabledEvidence',
    'portalWebhookEvidence',
    'webhookAuthenticationContract',
    'idempotencyContract',
    'statusRetryRateLimitContract',
    'supportEscalationRetentionTerms',
  ];

const TEST_FIELDS: Array<keyof PretiumCertificationTest> = [
  'operator',
  'approvedTinyAmountEvidence',
  'preReconciliation',
  'result',
  'postReconciliation',
  'killSwitchEvidence',
  'customerAccountingTreatment',
  'recoveryResult',
  'evidence',
];

const APPROVAL_FIELDS: Array<
  keyof PretiumCertificationEvidencePack['approvals']
> = [
  'operations',
  'reconciliation',
  'complianceRisk',
  'pilotOperator',
  'pretiumSupportCertification',
];

/** Validates completeness only; it never claims a live test actually occurred. */
export function verifyPretiumCertificationEvidence(
  pack: Partial<PretiumCertificationEvidencePack>,
): PretiumCertificationEvidenceResult {
  const missing: string[] = [];
  const account = pack.account;
  for (const field of ACCOUNT_FIELDS) {
    if (!isUsableEvidenceReference(account?.[field]))
      missing.push(`account.${field}`);
  }

  for (const testName of PRETIUM_LIVE_TESTS) {
    const test = pack.tests?.[testName];
    for (const field of TEST_FIELDS) {
      if (!isUsableEvidenceReference(test?.[field]))
        missing.push(`tests.${testName}.${field}`);
    }
  }

  const approvals = pack.approvals;
  for (const field of APPROVAL_FIELDS) {
    if (!isUsableEvidenceReference(approvals?.[field]))
      missing.push(`approvals.${field}`);
  }
  if (pack.promotionDecision !== 'CERTIFIED') missing.push('promotionDecision');
  if (!isUsableEvidenceReference(pack.promotionDecisionEvidence))
    missing.push('promotionDecisionEvidence');

  return {
    status: missing.length === 0 ? 'PASS' : 'INCOMPLETE',
    missing,
  };
}
