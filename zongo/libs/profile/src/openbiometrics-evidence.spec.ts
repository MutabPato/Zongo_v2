import {
  OPEN_BIOMETRICS_SCENARIOS,
  verifyOpenBiometricsEvidence,
} from './openbiometrics-evidence';

describe('OpenBiometrics evidence verification', () => {
  it('keeps an empty evidence pack incomplete', () => {
    const result = verifyOpenBiometricsEvidence({});

    expect(result.status).toBe('INCOMPLETE');
    expect(
      result.checks.find((check) => check.name === 'scenario-matrix')?.missing,
    ).toHaveLength(OPEN_BIOMETRICS_SCENARIOS.length);
  });

  it('requires an evidence link and PASS result for every scenario', () => {
    const result = verifyOpenBiometricsEvidence({
      scenarios: OPEN_BIOMETRICS_SCENARIOS.map((name) => ({
        name,
        result: 'PASS' as const,
      })),
    });

    expect(
      result.checks.find((check) => check.name === 'scenario-matrix')?.status,
    ).toBe('FAIL');
  });

  it('rejects placeholder provenance and promotion decisions', () => {
    const result = verifyOpenBiometricsEvidence({
      provenance: { sourceRepositoryCommit: 'NOT RUN' },
      promotionDecision: 'NOT PROMOTED',
    });

    expect(
      result.checks.find((check) => check.name === 'build-and-provenance')
        ?.missing,
    ).toContain('sourceRepositoryCommit');
    expect(
      result.checks.find((check) => check.name === 'promotion-decision')
        ?.status,
    ).toBe('FAIL');
  });
});
