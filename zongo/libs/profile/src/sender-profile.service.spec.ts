/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { KycTier, VerificationStatus } from '@prisma/client';
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { SenderProfileService } from './sender-profile.service';

describe('SenderProfileService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;

  it('creates a valid email-optional TIER_0 profile with contact preferences', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'profile_1',
      tier: KycTier.TIER_0,
      contactPreferences: { preferredChannel: 'WHATSAPP' },
    });
    const prisma = { senderProfile: { create } } as unknown as PrismaService;

    const profile = await new SenderProfileService(prisma, audit).create({
      userId: 'user_1',
      whatsappPhoneNumber: '+254700000001',
    });

    expect(profile.tier).toBe(KycTier.TIER_0);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: undefined,
          contactPreferences: { create: { preferredLanguage: 'en' } },
        }),
      }),
    );
  });

  it('promotes a successful Smile ID verification and records a phone replacement', async () => {
    const profile = {
      id: 'profile_1',
      senderPhoneNumber: '+254700000001',
      tier: KycTier.TIER_1,
    };
    const verification = {
      id: 'verification_1',
      status: VerificationStatus.SUCCEEDED,
    };
    const prisma = {
      senderProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue({
          ...profile,
          senderPhoneNumber: '+254700000002',
          tier: KycTier.TIER_1,
        }),
      },
      senderVerification: { create: jest.fn().mockResolvedValue(verification) },
      senderPhoneReplacement: {
        create: jest.fn().mockResolvedValue({ id: 'replacement_1' }),
      },
    } as unknown as PrismaService;

    const result = await new SenderProfileService(
      prisma,
      audit,
    ).recordVerification({
      senderProfileId: profile.id,
      providerReference: 'smile_1',
      verifiedPhoneNumber: '+254700000002',
      status: VerificationStatus.SUCCEEDED,
    });

    expect(result.replacedPhone).toBe(true);
    expect(prisma.senderPhoneReplacement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          previousPhoneNumber: '+254700000001',
          replacementPhoneNumber: '+254700000002',
          verificationId: verification.id,
        }),
      }),
    );
    expect(prisma.senderProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tier: KycTier.TIER_1,
          senderPhoneNumber: '+254700000002',
        }),
      }),
    );
  });

  it('requires the bound sender phone and enforces the TIER_0 daily allowance', async () => {
    const profile = {
      id: 'profile_1',
      userId: 'user_1',
      senderPhoneNumber: '+254700000001',
      tier: KycTier.TIER_0,
      tierLimitOverride: null,
    };
    const prisma = {
      senderProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
      },
      platformIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      tierLimitPolicy: {
        findUnique: jest.fn().mockResolvedValue({
          perTransferLimitMinor: 100n,
          dailyLimitMinor: 150n,
        }),
      },
      transferTransaction: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { sendAmountMinor: 75n } }),
      },
    } as unknown as PrismaService;
    const service = new SenderProfileService(prisma, audit);

    await expect(
      service.checkTransferEligibility(profile.id, '+254700000099', 10n),
    ).resolves.toEqual({ eligible: false, reason: 'PHONE_NOT_BOUND' });
    await expect(
      service.checkTransferEligibility(
        profile.id,
        profile.senderPhoneNumber,
        76n,
      ),
    ).resolves.toEqual({ eligible: false, reason: 'DAILY_LIMIT_EXCEEDED' });
    await expect(
      service.checkTransferEligibility(
        profile.id,
        profile.senderPhoneNumber,
        75n,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ eligible: true, tier: KycTier.TIER_0 }),
    );
  });

  it('denies transfer eligibility when the shared platform identity is blocked', async () => {
    const prisma = {
      senderProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'profile_1',
          userId: 'user_1',
          senderPhoneNumber: '+254700000001',
          tier: KycTier.TIER_0,
          tierLimitOverride: null,
        }),
      },
      platformIdentity: {
        findUnique: jest.fn().mockResolvedValue({ blockedAt: new Date() }),
      },
    } as unknown as PrismaService;

    await expect(
      new SenderProfileService(prisma, audit).checkTransferEligibility(
        'profile_1',
        '+254700000001',
        10n,
      ),
    ).resolves.toEqual({ eligible: false, reason: 'USER_BLOCKED' });
  });
});
