import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_LOG_PORT,
  DomainError,
  TransactionReferenceService,
  type AuditLogPort,
} from '@app/domain';
import { PrismaService } from '@app/db';
import { ENVELOPE_ENCRYPTION, EnvelopeEncryptionService } from '@app/security';

const DEFAULT_LIMITS = {
  TIER_1: { perTransferLimitMinor: 500_000n, dailyLimitMinor: 1_000_000n },
  TIER_2: { perTransferLimitMinor: 2_000_000n, dailyLimitMinor: 5_000_000n },
} as const;

export type InitiateTransferInput = {
  senderProfileId: string;
  senderPhoneNumber: string;
  chatId: string;
  inboundEventId: string;
  corridorId: string;
  beneficiaryId: string;
  sendAmountMinor: bigint;
  sendCurrency: string;
  payoutAmountMinor: bigint;
  payoutCurrency: string;
  quoteId: string;
  quoteSnapshot: Record<string, unknown>;
  idempotencyKey: string;
};

@Injectable()
export class TransferInitiationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: TransactionReferenceService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection: EnvelopeEncryptionService,
  ) {}

  async initiate(input: InitiateTransferInput) {
    if (input.sendAmountMinor <= 0n || input.payoutAmountMinor <= 0n)
      throw new DomainError(
        'INVALID_TRANSFER_AMOUNT',
        'Transfer amounts must be positive',
      );

    return this.prisma.$transaction(async (tx) => {
      // Serialize initiation attempts for one chat inside Postgres. The lock is
      // transaction-scoped and never crosses into partner I/O.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:${input.chatId}`}, 0))`,
      );
      const existing = await tx.transferTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
        if (
          metadata.senderProfileId !== input.senderProfileId ||
          existing.beneficiaryId !== input.beneficiaryId ||
          existing.sendAmountMinor !== input.sendAmountMinor ||
          metadata.quoteId !== input.quoteId
        ) {
          throw new DomainError(
            'TRANSFER_IDEMPOTENCY_CONFLICT',
            'Transfer idempotency key was reused with different inputs',
          );
        }
        return { duplicate: true, accepted: existing };
      }

      const controls = await tx.pilotControl.findMany({
        where: {
          key: { in: ['GLOBAL', 'INITIATION', 'CORRIDOR_PROVIDER'] },
        },
        select: { key: true, state: true },
      });
      if (controls.some((control) => control.state !== 'ENABLED'))
        throw new DomainError(
          'PILOT_INITIATION_PAUSED',
          'Pilot initiation is paused by operational control',
        );

      const session = await tx.whatsAppSession.findUnique({
        where: { activeChatKey: `chat:${input.chatId}` },
      });
      const profilePhoneIndex = await this.protection.blindIndex(
        input.senderPhoneNumber,
        'sender-phone',
      );
      if (
        !session ||
        (session.senderPhoneBlindIndex
          ? session.senderPhoneBlindIndex !== profilePhoneIndex
          : session.senderPhoneNumber !== input.senderPhoneNumber)
      )
        throw new DomainError(
          'WHATSAPP_SESSION_NOT_ACTIVE',
          'An active verified WhatsApp session is required',
        );
      if (session.transferId)
        throw new DomainError(
          'WHATSAPP_TRANSFER_ALREADY_ACTIVE',
          'This WhatsApp chat already owns a transfer',
        );
      if ('consentGivenAt' in session && !session.consentGivenAt)
        throw new DomainError(
          'WHATSAPP_CONSENT_REQUIRED',
          'Explicit WhatsApp consent is required before transfer initiation',
        );

      const profile = await tx.senderProfile.findUniqueOrThrow({
        where: { id: input.senderProfileId },
        include: { tierLimitOverride: true, pilotAllowlist: true },
      });
      const exposure = await tx.pilotExposurePolicy.findUnique({
        where: { id: 'pilot' },
      });
      if (exposure?.allowlistRequired && !profile.pilotAllowlist?.enabled)
        throw new DomainError(
          'PILOT_ALLOWLIST_REQUIRED',
          'The sender is not enabled for the pilot cohort',
        );
      const senderPhoneIndex = await this.protection.blindIndex(
        input.senderPhoneNumber,
        'sender-phone',
      );
      if (
        profile.senderPhoneBlindIndex
          ? profile.senderPhoneBlindIndex !== senderPhoneIndex
          : profile.senderPhoneNumber !== input.senderPhoneNumber
      )
        throw new DomainError(
          'PHONE_NOT_BOUND',
          'The sender phone is not bound',
        );
      if (profile.tier === 'TIER_0')
        throw new DomainError(
          'KYC_REQUIRED',
          'An approved verification is required',
        );
      const identity = await tx.platformIdentity.findUnique({
        where: { userId: profile.userId },
        select: { blockedAt: true },
      });
      if (identity?.blockedAt)
        throw new DomainError('USER_BLOCKED', 'The sender is blocked');

      const beneficiary = await tx.beneficiary.findUniqueOrThrow({
        where: { id: input.beneficiaryId },
      });
      if (
        beneficiary.userId !== profile.userId ||
        beneficiary.corridorId !== input.corridorId ||
        !beneficiary.isCurrent
      )
        throw new DomainError(
          'BENEFICIARY_NOT_AVAILABLE',
          'The beneficiary is not available',
        );

      const policy = await tx.corridorPolicy.findFirst({
        where: { corridorId: input.corridorId, isActive: true },
        orderBy: { version: 'desc' },
      });
      if (
        !policy ||
        policy.sendCurrency !== input.sendCurrency ||
        policy.payoutCurrency !== input.payoutCurrency
      )
        throw new DomainError(
          'CORRIDOR_POLICY_INVALID',
          'The corridor policy does not support this transfer',
        );
      if (
        policy.minSendAmountMinor &&
        input.sendAmountMinor < policy.minSendAmountMinor
      )
        throw new DomainError(
          'TRANSFER_AMOUNT_TOO_LOW',
          'The transfer amount is below the corridor minimum',
        );
      if (
        policy.maxSendAmountMinor &&
        input.sendAmountMinor > policy.maxSendAmountMinor
      )
        throw new DomainError(
          'TRANSFER_AMOUNT_TOO_HIGH',
          'The transfer amount exceeds the corridor maximum',
        );

      const fallbackLimits = DEFAULT_LIMITS[profile.tier];
      const perTransferLimitMinor =
        profile.tierLimitOverride?.perTransferLimitMinor ??
        fallbackLimits?.perTransferLimitMinor;
      const dailyLimitMinor =
        profile.tierLimitOverride?.dailyLimitMinor ??
        fallbackLimits?.dailyLimitMinor;
      if (
        perTransferLimitMinor === undefined ||
        dailyLimitMinor === undefined ||
        input.sendAmountMinor > perTransferLimitMinor
      )
        throw new DomainError(
          'PER_TRANSFER_LIMIT_EXCEEDED',
          'The transfer amount exceeds the sender per-transfer limit',
        );
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await tx.transferTransaction.aggregate({
        where: { senderUserId: profile.userId, createdAt: { gte: startOfDay } },
        _sum: { sendAmountMinor: true },
      });
      if (
        (sentToday._sum.sendAmountMinor ?? 0n) + input.sendAmountMinor >
        dailyLimitMinor
      )
        throw new DomainError(
          'DAILY_LIMIT_EXCEEDED',
          'The transfer would exceed the sender daily limit',
        );
      const pendingCount = await tx.transferTransaction.count({
        where: {
          status: { in: ['INITIATED', 'PENDING_COLLECTION', 'PENDING_PAYOUT'] },
        },
      });
      if (
        exposure?.maxPendingTransfers !== null &&
        exposure?.maxPendingTransfers !== undefined &&
        pendingCount >= exposure.maxPendingTransfers
      )
        throw new DomainError(
          'PENDING_EXPOSURE_LIMIT_EXCEEDED',
          'The pilot pending-transfer exposure limit has been reached',
        );
      if (
        exposure?.globalDailySendMinor !== null &&
        exposure?.globalDailySendMinor !== undefined
      ) {
        const globalSent = await tx.transferTransaction.aggregate({
          where: { createdAt: { gte: startOfDay } },
          _sum: { sendAmountMinor: true },
        });
        if (
          (globalSent._sum.sendAmountMinor ?? 0n) + input.sendAmountMinor >
          exposure.globalDailySendMinor
        )
          throw new DomainError(
            'GLOBAL_EXPOSURE_LIMIT_EXCEEDED',
            'The pilot global daily exposure limit has been reached',
          );
      }
      if (
        exposure?.maxAmbiguousTransfers !== null &&
        exposure?.maxAmbiguousTransfers !== undefined
      ) {
        const ambiguous = await tx.whatsAppSession.count({
          where: { status: 'WAITING' },
        });
        if (ambiguous >= exposure.maxAmbiguousTransfers)
          throw new DomainError(
            'AMBIGUOUS_EXPOSURE_LIMIT_EXCEEDED',
            'The pilot ambiguous-transfer exposure limit has been reached',
          );
      }
      if (
        exposure?.maxRecoveryCapacity !== null &&
        exposure?.maxRecoveryCapacity !== undefined
      ) {
        const recovery = await tx.transferTransaction.count({
          where: { status: 'PAYOUT_FAILED' },
        });
        if (recovery >= exposure.maxRecoveryCapacity)
          throw new DomainError(
            'RECOVERY_CAPACITY_EXCEEDED',
            'The pilot recovery capacity has been reached',
          );
      }
      if (
        exposure?.maxPartnerSettlementMinor !== null &&
        exposure?.maxPartnerSettlementMinor !== undefined
      ) {
        const settlement = await tx.transferTransaction.aggregate({
          where: { status: 'PENDING_PAYOUT' },
          _sum: { payoutAmountMinor: true },
        });
        if (
          (settlement._sum.payoutAmountMinor ?? 0n) + input.payoutAmountMinor >
          exposure.maxPartnerSettlementMinor
        )
          throw new DomainError(
            'PARTNER_SETTLEMENT_EXPOSURE_LIMIT_EXCEEDED',
            'The pilot partner-settlement exposure limit has been reached',
          );
      }

      const reference = this.references.generate();
      const transaction = await tx.transferTransaction.create({
        data: {
          reference,
          corridorId: input.corridorId,
          senderUserId: profile.userId,
          beneficiaryId: input.beneficiaryId,
          sendAmountMinor: input.sendAmountMinor,
          sendCurrency: input.sendCurrency as never,
          payoutAmountMinor: input.payoutAmountMinor,
          payoutCurrency: input.payoutCurrency as never,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            senderProfileId: input.senderProfileId,
            quoteId: input.quoteId,
            quoteSnapshot: input.quoteSnapshot,
            inboundEventId: input.inboundEventId,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.workerJob.create({
        data: {
          dedupKey: `${reference}:COLLECTION`,
          jobType: 'COLLECTION',
          transactionReference: reference,
          transactionId: transaction.id,
          payload: { reference },
        },
      });
      await tx.whatsAppSession.update({
        where: { id: session.id },
        data: { transferId: transaction.id },
      });
      await tx.auditEvent.create({
        data: {
          id: `audit_${transaction.id}_initiated`,
          eventType: 'BUSINESS',
          name: 'transfer.initiated',
          corridorId: input.corridorId,
          transactionId: transaction.id,
          payload: {
            reference,
            senderProfileId: input.senderProfileId,
            beneficiaryId: input.beneficiaryId,
            quoteId: input.quoteId,
            inboundEventId: input.inboundEventId,
          },
          createdAt: new Date(),
        },
      });
      return { duplicate: false, accepted: transaction };
    });
  }
}
