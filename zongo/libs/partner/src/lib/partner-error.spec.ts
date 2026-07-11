import { PartnerError, normalizePartnerError } from './partner-error';

describe('normalizePartnerError', () => {
  it('wraps vendor failures in a domain error', () => {
    const error = normalizePartnerError(new Error('partner timed out'));

    expect(error).toBeInstanceOf(PartnerError);
    expect(error.code).toBe('PARTNER_TEMPORARY_FAILURE');
    expect(error.message).toBe('partner timed out');
    expect(error.retryable).toBe(true);
  });
});
