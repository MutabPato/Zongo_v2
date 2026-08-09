import { BadRequestException } from '@nestjs/common';
import { parseBreakGlass, parseLogin, parseDecimal } from './admin-v1.dto';

describe('admin v1 DTO validation', () => {
  it('rejects malformed TOTP input before the service boundary', () => {
    expect(() => parseLogin({ userId: 'ops', totpCode: '12' })).toThrow(
      BadRequestException,
    );
  });

  it('requires an explicit break-glass reason', () => {
    expect(() =>
      parseBreakGlass({
        userId: 'admin',
        emergencySecret: 'secret',
        reason: ' ',
      }),
    ).toThrow(BadRequestException);
  });

  it('keeps money values as validated decimal strings', () => {
    expect(parseDecimal('000123', 'amount')).toBe('000123');
    expect(() => parseDecimal('12.3', 'amount')).toThrow(BadRequestException);
  });
});
