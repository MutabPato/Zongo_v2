import { PartnerError, normalizePartnerError } from './partner-error';

describe('normalizePartnerError', () => {
  it('wraps vendor failures in a domain error', () => {
    const error = normalizePartnerError(new Error('partner timed out'));

    expect(error).toBeInstanceOf(PartnerError);
    expect(error.code).toBe('PARTNER_TEMPORARY_FAILURE');
    expect(error.message).toBe('partner timed out');
    expect(error.retryable).toBe(true);
  });

  it('does not persist serialized or credential-bearing provider messages', () => {
    const error = normalizePartnerError(
      new Error('{"token":"secret","phone":"+254700000001"}'),
    );

    expect(error.message).toBe('Partner request failed');
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('+254700000001');
  });
});
