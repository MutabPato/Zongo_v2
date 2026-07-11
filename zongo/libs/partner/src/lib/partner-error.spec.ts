import { PartnerError, normalizePartnerError } from './partner-error';

describe('normalizePartnerError', () => {
  it('wraps vendor failures in a domain error', () => {
    const error = normalizePartnerError('TIMEOUT', 'partner timed out');

    expect(error).toBeInstanceOf(PartnerError);
    expect(error.code).toBe('PARTNER_TIMEOUT');
    expect(error.message).toBe('partner timed out');
  });
});
