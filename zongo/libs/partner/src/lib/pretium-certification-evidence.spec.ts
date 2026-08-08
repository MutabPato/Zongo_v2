import {
  PRETIUM_LIVE_TESTS,
  verifyPretiumCertificationEvidence,
  type PretiumCertificationEvidencePack,
} from './pretium-certification-evidence';

function completePack(): PretiumCertificationEvidencePack {
  const reference = 'evidence://pretium/certification';
  const test = {
    operator: 'operator-1',
    approvedTinyAmountEvidence: reference,
    preReconciliation: reference,
    result: reference,
    postReconciliation: reference,
    killSwitchEvidence: reference,
    customerAccountingTreatment: reference,
    recoveryResult: reference,
    evidence: reference,
  };
  return {
    account: {
      merchantIdentifier: reference,
      cdfEnabledEvidence: reference,
      kesEnabledEvidence: reference,
      portalWebhookEvidence: reference,
      webhookAuthenticationContract: reference,
      idempotencyContract: reference,
      statusRetryRateLimitContract: reference,
      supportEscalationRetentionTerms: reference,
    },
    tests: Object.fromEntries(PRETIUM_LIVE_TESTS.map((name) => [name, test])),
    approvals: {
      operations: reference,
      reconciliation: reference,
      complianceRisk: reference,
      pilotOperator: reference,
      pretiumSupportCertification: reference,
    },
    promotionDecision: 'CERTIFIED',
    promotionDecisionEvidence: reference,
  };
}

describe('Pretium certification evidence verification', () => {
  it('keeps an empty pack incomplete', () => {
    expect(verifyPretiumCertificationEvidence({}).status).toBe('INCOMPLETE');
  });

  it('requires every live test and named approval', () => {
    const pack = completePack();
    delete pack.tests.statusLookup;
    pack.approvals.reconciliation = 'TBD';

    const result = verifyPretiumCertificationEvidence(pack);

    expect(result.missing).toEqual(
      expect.arrayContaining([
        'tests.statusLookup.operator',
        'approvals.reconciliation',
      ]),
    );
  });

  it('rejects a not-certified decision even when fields are populated', () => {
    const pack = completePack();
    pack.promotionDecision = 'NOT_CERTIFIED';

    expect(verifyPretiumCertificationEvidence(pack).missing).toContain(
      'promotionDecision',
    );
  });
});
