import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, DomainError, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { KycTier, VerificationStatus } from '@prisma/client';

export type CreateSenderProfileInput = {
  userId: string;
  whatsappPhoneNumber: string;
  legalName?: string;
  email?: string;
  backupPhoneNumber?: string;
  preferredLanguage?: string;
};

export type VerificationOutcomeInput = {
  senderProfileId: string;
  providerReference: string;
  verifiedPhoneNumber: string;
  status: VerificationStatus;
  failureReason?: string;
};

export type TransferEligibility =
  | {
      eligible: true;
      tier: KycTier;
      perTransferLimitMinor: bigint;
      dailyLimitMinor: bigint;
    }
  | {
      eligible: false;
      reason:
        | 'PHONE_NOT_BOUND'
        | 'PER_TRANSFER_LIMIT_EXCEEDED'
        | 'DAILY_LIMIT_EXCEEDED';
    };

const DEFAULT_LIMITS: Record<
  KycTier,
  { perTransferLimitMinor: bigint; dailyLimitMinor: bigint }
> = {
  TIER_0: { perTransferLimitMinor: 10_000n, dailyLimitMinor: 20_000n },
  TIER_1: { perTransferLimitMinor: 500_000n, dailyLimitMinor: 1_000_000n },
  TIER_2: { perTransferLimitMinor: 2_000_000n, dailyLimitMinor: 5_000_000n },
};

@Injectable()
export class SenderProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
  ) {}

  async create(input: CreateSenderProfileInput) {
    const profile = await this.prisma.senderProfile.create({
      data: {
        userId: input.userId,
        legalName: input.legalName,
        email: input.email,
        whatsappPhoneNumber: input.whatsappPhoneNumber,
        backupPhoneNumber: input.backupPhoneNumber,
        contactPreferences: {
          create: { preferredLanguage: input.preferredLanguage ?? 'en' },
        },
      },
      include: { contactPreferences: true },
    });
    await this.appendAudit('sender.profile.created', profile.id, {
      tier: profile.tier,
    });
    return profile;
  }

  /** AdminJS should manage these durable rows; this service is its authorized write boundary. */
  async setGlobalTierLimits(
    tier: KycTier,
    perTransferLimitMinor: bigint,
    dailyLimitMinor: bigint,
    adminId: string,
  ) {
    this.assertPositiveLimits(perTransferLimitMinor, dailyLimitMinor);
    return this.prisma.tierLimitPolicy.upsert({
      where: { tier },
      create: {
        tier,
        perTransferLimitMinor,
        dailyLimitMinor,
        updatedByAdminId: adminId,
      },
      update: {
        perTransferLimitMinor,
        dailyLimitMinor,
        updatedByAdminId: adminId,
      },
    });
  }

  async setSenderLimitOverride(
    senderProfileId: string,
    perTransferLimitMinor: bigint | undefined,
    dailyLimitMinor: bigint | undefined,
    reason: string,
    adminId: string,
  ) {
    if (perTransferLimitMinor !== undefined && perTransferLimitMinor <= 0n)
      throw new DomainError(
        'INVALID_LIMIT',
        'Per-transfer limit must be positive',
      );
    if (dailyLimitMinor !== undefined && dailyLimitMinor <= 0n)
      throw new DomainError('INVALID_LIMIT', 'Daily limit must be positive');
    return this.prisma.senderTierLimitOverride.upsert({
      where: { senderProfileId },
      create: {
        senderProfileId,
        perTransferLimitMinor,
        dailyLimitMinor,
        reason,
        updatedByAdminId: adminId,
      },
      update: {
        perTransferLimitMinor,
        dailyLimitMinor,
        reason,
        updatedByAdminId: adminId,
      },
    });
  }

  async recordVerification(input: VerificationOutcomeInput) {
    const profile = await this.prisma.senderProfile.findUniqueOrThrow({
      where: { id: input.senderProfileId },
    });
    const verification = await this.prisma.senderVerification.create({
      data: {
        senderProfileId: profile.id,
        providerReference: input.providerReference,
        status: input.status,
        verifiedPhoneNumber: input.verifiedPhoneNumber,
        failureReason: input.failureReason,
        completedAt: new Date(),
      },
    });

    if (input.status !== VerificationStatus.SUCCEEDED) {
      await this.appendAudit('sender.verification.failed', profile.id, {
        verificationId: verification.id,
      });
      return { profile, verification, replacedPhone: false };
    }

    const replacedPhone = Boolean(
      profile.senderPhoneNumber &&
      profile.senderPhoneNumber !== input.verifiedPhoneNumber,
    );
    if (replacedPhone) {
      await this.prisma.senderPhoneReplacement.create({
        data: {
          senderProfileId: profile.id,
          previousPhoneNumber: profile.senderPhoneNumber!,
          replacementPhoneNumber: input.verifiedPhoneNumber,
          verificationId: verification.id,
        },
      });
    }
    const updatedProfile = await this.prisma.senderProfile.update({
      where: { id: profile.id },
      data: {
        senderPhoneNumber: input.verifiedPhoneNumber,
        tier: KycTier.TIER_1,
        verifiedAt: new Date(),
      },
    });
    await this.appendAudit(
      replacedPhone ? 'sender.phone.replaced' : 'sender.verification.succeeded',
      profile.id,
      {
        verificationId: verification.id,
        tier: updatedProfile.tier,
      },
    );
    return { profile: updatedProfile, verification, replacedPhone };
  }

  async checkTransferEligibility(
    senderProfileId: string,
    senderPhoneNumber: string,
    amountMinor: bigint,
    at = new Date(),
  ): Promise<TransferEligibility> {
    const profile = await this.prisma.senderProfile.findUniqueOrThrow({
      where: { id: senderProfileId },
      include: { tierLimitOverride: true },
    });
    if (profile.senderPhoneNumber !== senderPhoneNumber)
      return { eligible: false, reason: 'PHONE_NOT_BOUND' };

    const global = await this.prisma.tierLimitPolicy.findUnique({
      where: { tier: profile.tier },
    });
    const fallback = DEFAULT_LIMITS[profile.tier];
    const perTransferLimitMinor =
      profile.tierLimitOverride?.perTransferLimitMinor ??
      global?.perTransferLimitMinor ??
      fallback.perTransferLimitMinor;
    const dailyLimitMinor =
      profile.tierLimitOverride?.dailyLimitMinor ??
      global?.dailyLimitMinor ??
      fallback.dailyLimitMinor;
    if (amountMinor > perTransferLimitMinor)
      return { eligible: false, reason: 'PER_TRANSFER_LIMIT_EXCEEDED' };

    const startOfDay = new Date(at);
    startOfDay.setHours(0, 0, 0, 0);
    const sent = await this.prisma.transferTransaction.aggregate({
      where: { senderUserId: profile.userId, createdAt: { gte: startOfDay } },
      _sum: { sendAmountMinor: true },
    });
    if ((sent._sum.sendAmountMinor ?? 0n) + amountMinor > dailyLimitMinor)
      return { eligible: false, reason: 'DAILY_LIMIT_EXCEEDED' };
    return {
      eligible: true,
      tier: profile.tier,
      perTransferLimitMinor,
      dailyLimitMinor,
    };
  }

  private assertPositiveLimits(
    perTransferLimitMinor: bigint,
    dailyLimitMinor: bigint,
  ): void {
    if (perTransferLimitMinor <= 0n || dailyLimitMinor <= 0n)
      throw new DomainError('INVALID_LIMIT', 'Tier limits must be positive');
  }

  private async appendAudit(
    name: string,
    senderProfileId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name,
      actorType: 'SENDER_PROFILE',
      actorId: senderProfileId,
      payload,
      createdAt: new Date(),
    });
  }
}
