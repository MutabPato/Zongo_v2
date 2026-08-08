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
});
