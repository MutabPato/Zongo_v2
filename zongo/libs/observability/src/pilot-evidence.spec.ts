import { isUsableEvidenceReference } from './pilot-evidence';

describe('pilot evidence references', () => {
  it('rejects empty and placeholder references', () => {
    for (const value of ['', '  ', 'TBD', 'TODO', 'pending', '<attach-link>'])
      expect(isUsableEvidenceReference(value)).toBe(false);
  });

  it('accepts an auditable evidence reference', () => {
    expect(isUsableEvidenceReference('evidence://pretium/live-test-001')).toBe(
      true,
    );
  });
});
