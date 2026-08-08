import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, DomainError, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { ENVELOPE_ENCRYPTION, EnvelopeEncryptionService } from '@app/security';
import { KycTier, VerificationStatus } from '@prisma/client';

export type CreateSenderProfileInput = {
  userId: string;
  whatsappPhoneNumber: string;
  legalName?: string;
  email?: string;
  backupPhoneNumber?: string;
  preferredLanguage?: string;
};

export type TechnicalVerificationInput = {
  senderProfileId: string;
  providerReference: string;
  idempotencyKey: string;
  verifiedPhoneNumber: string;
  status?: Extract<
    VerificationStatus,
    'PENDING' | 'TECHNICAL_REVIEW' | 'HUMAN_REVIEW' | 'REJECTED' | 'ESCALATED'
  >;
  failureReason?: string;
  collectedByIdentityId?: string;
  consentAt?: Date;
  evidence?: Record<string, unknown>;
};

export type ApproveVerificationInput = {
  verificationId: string;
  reviewerIdentityId: string;
  decisionReason: string;
};

export type ExpireVerificationInput = {
  verificationId: string;
  reason: string;
};

export type ResolveVerificationInput = {
  verificationId: string;
  reviewerIdentityId: string;
  decision: Extract<VerificationStatus, 'REJECTED' | 'ESCALATED'>;
  decisionReason: string;
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
        | 'USER_BLOCKED'
        | 'KYC_REQUIRED'
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
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection: EnvelopeEncryptionService,
  ) {}

  async create(input: CreateSenderProfileInput) {
    const email = input.email
      ? await this.protection.encrypt(input.email, 'sender-email')
      : undefined;
    const senderPhone = await this.protection.encrypt(
      input.whatsappPhoneNumber,
      'sender-phone',
    );
    const backupPhone = input.backupPhoneNumber
      ? await this.protection.encrypt(input.backupPhoneNumber, 'sender-phone')
      : undefined;
    const profile = await this.prisma.senderProfile.create({
      data: {
        userId: input.userId,
        legalName: input.legalName,
        email: undefined,
        emailCiphertext: email ? JSON.stringify(email) : undefined,
        emailBlindIndex: input.email
          ? await this.protection.blindIndex(input.email, 'sender-email')
          : undefined,
        senderPhoneNumber: undefined,
        senderPhoneCiphertext: JSON.stringify(senderPhone),
        senderPhoneBlindIndex: await this.protection.blindIndex(
          input.whatsappPhoneNumber,
          'sender-phone',
        ),
        // Keep the legacy plaintext field empty for all new profiles. The
        // encrypted sender-phone value is the canonical recoverable contact.
        whatsappPhoneNumber: undefined,
        backupPhoneNumber: undefined,
        backupPhoneCiphertext: backupPhone
          ? JSON.stringify(backupPhone)
          : undefined,
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

  async recordTechnicalVerification(input: TechnicalVerificationInput) {
    const existing = await this.prisma.senderVerification.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.senderProfileId !== input.senderProfileId ||
        existing.providerReference !== input.providerReference
      ) {
        throw new DomainError(
          'VERIFICATION_IDEMPOTENCY_CONFLICT',
          'Verification idempotency key was reused with different inputs',
        );
      }
      return existing;
    }

    const profile = await this.prisma.senderProfile.findUniqueOrThrow({
      where: { id: input.senderProfileId },
    });
    const verification = await this.prisma.senderVerification.create({
      data: {
        senderProfileId: profile.id,
        providerReference: input.providerReference,
        providerReferenceBlindIndex: await this.protection.blindIndex(
          input.providerReference,
          'provider-reference',
        ),
        idempotencyKey: input.idempotencyKey,
        status: input.status ?? VerificationStatus.TECHNICAL_REVIEW,
        verifiedPhoneNumber: input.verifiedPhoneNumber,
        evidenceCiphertext: input.evidence
          ? (JSON.stringify(
              await this.protection.encrypt(
                JSON.stringify(input.evidence),
                'kyc-evidence',
              ),
            ) as never)
          : undefined,
        failureReason: input.failureReason,
        collectedByIdentityId: input.collectedByIdentityId,
        consentAt: input.consentAt,
      },
    });

    if (
      verification.status === VerificationStatus.REJECTED ||
      verification.status === VerificationStatus.ESCALATED
    ) {
      await this.appendAudit(
        'sender.verification.review_required',
        profile.id,
        {
          verificationId: verification.id,
          status: verification.status,
        },
      );
    }
    return verification;
  }

  async approveVerification(input: ApproveVerificationInput) {
    if (!input.decisionReason.trim()) {
      throw new DomainError(
        'VERIFICATION_DECISION_REASON_REQUIRED',
        'A verification approval requires a decision reason',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.senderVerification.findUniqueOrThrow({
        where: { id: input.verificationId },
        include: { senderProfile: true },
      });
      if (verification.status !== VerificationStatus.HUMAN_REVIEW) {
        throw new DomainError(
          'VERIFICATION_NOT_READY_FOR_APPROVAL',
          'Only a verification in human review can be approved',
        );
      }
      if (
        verification.collectedByIdentityId &&
        verification.collectedByIdentityId === input.reviewerIdentityId
      ) {
        throw new DomainError(
          'VERIFICATION_REVIEWER_NOT_INDEPENDENT',
          'The verification reviewer must be independent of the collector',
        );
      }
      if (!verification.verifiedPhoneNumber) {
        throw new DomainError(
          'VERIFIED_PHONE_REQUIRED',
          'An approved verification must include a verified phone number',
        );
      }

      const now = new Date();
      const approved = await tx.senderVerification.update({
        where: { id: verification.id },
        data: {
          status: VerificationStatus.APPROVED,
          reviewerIdentityId: input.reviewerIdentityId,
          decisionReason: input.decisionReason,
          reviewedAt: now,
          completedAt: now,
        },
      });

      const previousPhone =
        verification.senderProfile.senderPhoneNumber ??
        (verification.senderProfile.senderPhoneCiphertext
          ? await this.protection.decrypt(
              JSON.parse(verification.senderProfile.senderPhoneCiphertext),
              'sender-phone',
            )
          : null);
      const replacedPhone = Boolean(
        previousPhone && previousPhone !== verification.verifiedPhoneNumber,
      );
      if (replacedPhone) {
        await tx.senderPhoneReplacement.create({
          data: {
            senderProfileId: verification.senderProfile.id,
            previousPhoneNumber: undefined,
            replacementPhoneNumber: undefined,
            previousPhoneCiphertext: JSON.stringify(
              await this.protection.encrypt(previousPhone!, 'sender-phone'),
            ),
            replacementPhoneCiphertext: JSON.stringify(
              await this.protection.encrypt(
                verification.verifiedPhoneNumber,
                'sender-phone',
              ),
            ),
            previousPhoneBlindIndex: await this.protection.blindIndex(
              previousPhone!,
              'sender-phone',
            ),
            replacementPhoneBlindIndex: await this.protection.blindIndex(
              verification.verifiedPhoneNumber,
              'sender-phone',
            ),
            verificationId: verification.id,
          },
        });
      }
      const encryptedPhone = await this.protection.encrypt(
        verification.verifiedPhoneNumber,
        'sender-phone',
      );
      const updatedProfile = await tx.senderProfile.update({
        where: { id: verification.senderProfile.id },
        data: {
          senderPhoneNumber: null,
          whatsappPhoneNumber: null,
          senderPhoneCiphertext: JSON.stringify(encryptedPhone),
          senderPhoneBlindIndex: await this.protection.blindIndex(
            verification.verifiedPhoneNumber,
            'sender-phone',
          ),
          tier: KycTier.TIER_1,
          verifiedAt: now,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: `audit_${verification.id}_${now.getTime()}`,
          eventType: 'BUSINESS',
          name: replacedPhone
            ? 'sender.phone.replaced'
            : 'sender.verification.approved',
          actorType: 'ADMIN',
          actorId: input.reviewerIdentityId,
          payload: {
            verificationId: verification.id,
            tier: updatedProfile.tier,
            decisionReason: input.decisionReason,
          },
          createdAt: now,
        },
      });
      return { profile: updatedProfile, verification: approved, replacedPhone };
    });
  }

  async resolveVerification(input: ResolveVerificationInput) {
    if (!input.decisionReason.trim())
      throw new DomainError(
        'VERIFICATION_DECISION_REASON_REQUIRED',
        'A verification decision requires a reason',
      );
    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.senderVerification.findUniqueOrThrow({
        where: { id: input.verificationId },
      });
      if (
        verification.status !== VerificationStatus.TECHNICAL_REVIEW &&
        verification.status !== VerificationStatus.HUMAN_REVIEW
      )
        throw new DomainError(
          'VERIFICATION_NOT_REVIEWABLE',
          'Only a reviewable verification case can be resolved',
        );
      const resolved = await tx.senderVerification.update({
        where: { id: verification.id },
        data: {
          status: input.decision,
          reviewerIdentityId: input.reviewerIdentityId,
          decisionReason: input.decisionReason,
          reviewedAt: new Date(),
          completedAt:
            input.decision === VerificationStatus.REJECTED
              ? new Date()
              : undefined,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: `audit_${verification.id}_${Date.now()}`,
          eventType: 'BUSINESS',
          name: `sender.verification.${input.decision.toLowerCase()}`,
          actorType: 'ADMIN',
          actorId: input.reviewerIdentityId,
          payload: {
            verificationId: verification.id,
            decision: input.decision,
            decisionReason: input.decisionReason,
          },
          createdAt: new Date(),
        },
      });
      return resolved;
    });
  }

  async expireVerification(input: ExpireVerificationInput) {
    if (!input.reason.trim()) {
      throw new DomainError(
        'VERIFICATION_EXPIRY_REASON_REQUIRED',
        'Verification expiry requires a reason',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.senderVerification.findUniqueOrThrow({
        where: { id: input.verificationId },
        include: { senderProfile: true },
      });
      if (verification.status !== VerificationStatus.APPROVED) {
        throw new DomainError(
          'VERIFICATION_NOT_APPROVED',
          'Only an approved verification can expire',
        );
      }

      const now = new Date();
      const expired = await tx.senderVerification.update({
        where: { id: verification.id },
        data: {
          status: VerificationStatus.EXPIRED,
          decisionReason: input.reason,
          reviewedAt: now,
          expiresAt: now,
        },
      });
      const profile = await tx.senderProfile.update({
        where: { id: verification.senderProfile.id },
        data: { tier: KycTier.TIER_0, verifiedAt: null },
      });
      await tx.auditEvent.create({
        data: {
          id: `audit_${verification.id}_expired_${now.getTime()}`,
          eventType: 'BUSINESS',
          name: 'sender.verification.expired',
          actorType: 'SYSTEM',
          payload: { verificationId: verification.id, reason: input.reason },
          createdAt: now,
        },
      });
      return { profile, verification: expired };
    });
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
    const identity = await this.prisma.platformIdentity.findUnique({
      where: { userId: profile.userId },
      select: { blockedAt: true },
    });
    if (identity?.blockedAt) return { eligible: false, reason: 'USER_BLOCKED' };
    const boundPhone =
      profile.senderPhoneNumber ??
      (profile.senderPhoneCiphertext
        ? await this.protection.decrypt(
            JSON.parse(profile.senderPhoneCiphertext),
            'sender-phone',
          )
        : null);
    if (boundPhone !== senderPhoneNumber)
      return { eligible: false, reason: 'PHONE_NOT_BOUND' };
    if (profile.tier === KycTier.TIER_0)
      return { eligible: false, reason: 'KYC_REQUIRED' };

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
