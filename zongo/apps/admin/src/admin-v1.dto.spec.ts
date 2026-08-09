import { BadRequestException } from '@nestjs/common';
import {
  parseBreakGlass,
  parseDecimal,
  parseExposurePolicy,
  parseLogin,
  parsePilotPublish,
  parseReconciliationAssignment,
  parseTierOneCaps,
} from './admin-v1.dto';

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

  it('validates mutation bodies before administrative services run', () => {
    expect(
      parseReconciliationAssignment({
        ownerIdentityId: 'ops',
        reason: 'assign',
      }),
    ).toEqual({ ownerIdentityId: 'ops', reason: 'assign' });
    expect(() =>
      parseReconciliationAssignment({ ownerIdentityId: 'ops' }),
    ).toThrow(BadRequestException);
    expect(
      parseTierOneCaps({
        perTransferLimitMinor: '100',
        dailyLimitMinor: '1000',
      }),
    ).toEqual({
      perTransferLimitMinor: '100',
      dailyLimitMinor: '1000',
    });
    expect(() =>
      parseTierOneCaps({ perTransferLimitMinor: 100, dailyLimitMinor: '1000' }),
    ).toThrow(BadRequestException);
  });

  it('keeps exposure and publication money fields decimal-safe', () => {
    expect(parseExposurePolicy({ globalDailySendMinor: '001000' })).toEqual({
      allowlistRequired: undefined,
      maxPendingTransfers: undefined,
      maxAmbiguousTransfers: undefined,
      maxPartnerSettlementMinor: undefined,
      maxRecoveryCapacity: undefined,
      globalDailySendMinor: '001000',
    });
    expect(() => parseExposurePolicy({ globalDailySendMinor: 1000 })).toThrow(
      BadRequestException,
    );
    expect(() => parsePilotPublish({ noWaiverConfirmed: true })).toThrow(
      BadRequestException,
    );
  });
});
