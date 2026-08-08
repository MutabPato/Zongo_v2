/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { KycTier, VerificationStatus } from '@prisma/client';
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { SenderProfileService } from './sender-profile.service';

describe('SenderProfileService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;
  const protection = {
    encrypt: jest.fn((value: string) => ({
      algorithm: 'aes-256-gcm' as const,
      keyVersion: 'v1',
      iv: 'iv',
      ciphertext: value,
      authTag: 'tag',
    })),
    decrypt: jest.fn((value: { ciphertext: string }) => value.ciphertext),
    blindIndex: jest.fn((value: string) => `blind:${value}`),
  } as any;

  it('creates a valid email-optional TIER_0 profile with contact preferences', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'profile_1',
      tier: KycTier.TIER_0,
      contactPreferences: { preferredChannel: 'WHATSAPP' },
    });
    const prisma = { senderProfile: { create } } as unknown as PrismaService;

    const profile = await new SenderProfileService(
      prisma,
      audit,
      protection,
    ).create({
      userId: 'user_1',
      whatsappPhoneNumber: '+254700000001',
    });

    expect(profile.tier).toBe(KycTier.TIER_0);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: undefined,
          whatsappPhoneNumber: undefined,
          contactPreferences: { create: { preferredLanguage: 'en' } },
        }),
      }),
    );
  });

  it('records technical verification evidence without promoting TIER_1', async () => {
    const profile = {
      id: 'profile_1',
      senderPhoneNumber: '+254700000001',
      tier: KycTier.TIER_0,
    };
    const verification = {
      id: 'verification_1',
      senderProfileId: profile.id,
      providerReference: 'openbio_1',
      idempotencyKey: 'case_1',
      status: VerificationStatus.HUMAN_REVIEW,
    };
    const prisma = {
      senderProfile: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
      },
      senderVerification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(verification),
      },
    } as unknown as PrismaService;

    const result = await new SenderProfileService(
      prisma,
      audit,
      protection,
    ).recordTechnicalVerification({
      senderProfileId: profile.id,
      providerReference: 'openbio_1',
      idempotencyKey: 'case_1',
      verifiedPhoneNumber: '+254700000002',
      status: VerificationStatus.HUMAN_REVIEW,
    });

    expect(result.status).toBe(VerificationStatus.HUMAN_REVIEW);
    expect(prisma.senderProfile.findUniqueOrThrow).toHaveBeenCalled();
    expect(prisma.senderVerification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'case_1',
          status: VerificationStatus.HUMAN_REVIEW,
        }),
      }),
    );
  });

  it('atomically approves an independent human review and promotes TIER_1', async () => {
    const verification = {
      id: 'verification_1',
      status: VerificationStatus.HUMAN_REVIEW,
      verifiedPhoneNumber: '+254700000002',
      collectedByIdentityId: 'collector_1',
      senderProfile: {
        id: 'profile_1',
        senderPhoneNumber: '+254700000001',
        tier: KycTier.TIER_0,
      },
    };
    const tx = {
      senderVerification: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(verification),
        update: jest.fn().mockResolvedValue({
          ...verification,
          status: VerificationStatus.APPROVED,
        }),
      },
      senderPhoneReplacement: {
        create: jest.fn().mockResolvedValue({ id: 'replacement_1' }),
      },
      senderProfile: {
        update: jest.fn().mockResolvedValue({
          ...verification.senderProfile,
          senderPhoneNumber: verification.verifiedPhoneNumber,
          tier: KycTier.TIER_1,
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    const result = await new SenderProfileService(
      prisma,
      audit,
      protection,
    ).approveVerification({
      verificationId: verification.id,
      reviewerIdentityId: 'reviewer_1',
      decisionReason:
        'Document, liveness, screening, and phone evidence approved',
    });

    expect(result.profile.tier).toBe(KycTier.TIER_1);
    expect(result.replacedPhone).toBe(true);
    expect(tx.senderPhoneReplacement.create).toHaveBeenCalled();
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'sender.phone.replaced',
          actorId: 'reviewer_1',
        }),
      }),
    );
  });

  it('rejects approval by the same identity that collected the verification', async () => {
    const tx = {
      senderVerification: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'verification_1',
          status: VerificationStatus.HUMAN_REVIEW,
          verifiedPhoneNumber: '+254700000001',
          collectedByIdentityId: 'same_identity',
          senderProfile: { id: 'profile_1', senderPhoneNumber: null },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    await expect(
      new SenderProfileService(prisma, audit, protection).approveVerification({
        verificationId: 'verification_1',
        reviewerIdentityId: 'same_identity',
        decisionReason: 'Not allowed',
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_REVIEWER_NOT_INDEPENDENT' });
  });

  it('records an auditable rejection without promoting the sender', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'verification_1',
      status: VerificationStatus.REJECTED,
    });
    const tx = {
      senderVerification: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'verification_1',
          status: VerificationStatus.HUMAN_REVIEW,
        }),
        update,
      },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    await expect(
      new SenderProfileService(prisma, audit, protection).resolveVerification({
        verificationId: 'verification_1',
        reviewerIdentityId: 'reviewer_1',
        decision: VerificationStatus.REJECTED,
        decisionReason: 'Document evidence did not meet the pilot standard',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.REJECTED }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerIdentityId: 'reviewer_1',
          status: VerificationStatus.REJECTED,
        }),
      }),
    );
  });

  it('expires an approved verification and revokes TIER_1 eligibility', async () => {
    const tx = {
      senderVerification: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'verification_1',
          status: VerificationStatus.APPROVED,
          senderProfile: { id: 'profile_1', tier: KycTier.TIER_1 },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'verification_1',
          status: VerificationStatus.EXPIRED,
        }),
      },
      senderProfile: {
        update: jest.fn().mockResolvedValue({
          id: 'profile_1',
          tier: KycTier.TIER_0,
          verifiedAt: null,
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    const result = await new SenderProfileService(
      prisma,
      audit,
      protection,
    ).expireVerification({
      verificationId: 'verification_1',
      reason: 'Identity document expired',
    });

    expect(result.profile.tier).toBe(KycTier.TIER_0);
    expect(tx.senderVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: VerificationStatus.EXPIRED }),
      }),
    );
  });

  it('requires the bound sender phone and denies transfers for TIER_0', async () => {
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
    const service = new SenderProfileService(prisma, audit, protection);

    await expect(
      service.checkTransferEligibility(profile.id, '+254700000099', 10n),
    ).resolves.toEqual({ eligible: false, reason: 'PHONE_NOT_BOUND' });
    await expect(
      service.checkTransferEligibility(
        profile.id,
        profile.senderPhoneNumber,
        75n,
      ),
    ).resolves.toEqual({ eligible: false, reason: 'KYC_REQUIRED' });
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
      new SenderProfileService(
        prisma,
        audit,
        protection,
      ).checkTransferEligibility('profile_1', '+254700000001', 10n),
    ).resolves.toEqual({ eligible: false, reason: 'USER_BLOCKED' });
  });
});
