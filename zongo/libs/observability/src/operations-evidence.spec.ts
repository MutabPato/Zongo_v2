import { verifyOperationsEvidence } from './operations-evidence';

describe('operations evidence verification', () => {
  it('keeps an empty pack incomplete', () => {
    expect(verifyOperationsEvidence({}).status).toBe('INCOMPLETE');
  });

  it('requires positive approved recovery targets', () => {
    const result = verifyOperationsEvidence({
      approvedRpoMinutes: 0,
      approvedRtoMinutes: 'not-a-number',
    });

    expect(result.missing).toEqual(
      expect.arrayContaining(['approvedRpoMinutes', 'approvedRtoMinutes']),
    );
  });

  it('rejects placeholder operational evidence references', () => {
    const result = verifyOperationsEvidence({
      deploymentCommitOrImageDigest: 'TBD',
      metricsEvidence: '<attach-link>',
    });

    expect(result.missing).toEqual(
      expect.arrayContaining([
        'deploymentCommitOrImageDigest',
        'metricsEvidence',
      ]),
    );
  });

  it('requires the deployment evidence to identify a commit or image digest', () => {
    expect(
      verifyOperationsEvidence({
        deploymentCommitOrImageDigest: 'release-1',
      }).missing,
    ).toContain('deploymentCommitOrImageDigest');
    expect(
      verifyOperationsEvidence({
        deploymentCommitOrImageDigest: 'a'.repeat(40),
      }).missing,
    ).not.toContain('deploymentCommitOrImageDigest');
  });
});
