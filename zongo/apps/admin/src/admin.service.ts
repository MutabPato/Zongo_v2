import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { BeneficiaryService } from '@app/beneficiary';
import { SenderProfileService } from '@app/profile';
import { ENVELOPE_ENCRYPTION, EnvelopeEncryptionService } from '@app/security';
import { verifyKeyLifecycle } from '@app/security';
import { verifyPretiumRuntimeConfiguration } from '@app/partner';
import {
  hashPilotReleasePublication,
  isUsableEvidenceReference,
  signPilotReleasePublication,
  verifyPilotReleasePublicationSignature,
} from '@app/observability';
import { WorkerJobProcessor } from '../../worker/src/worker-job.processor';
import {
  AdminRole,
  JobType,
  PilotControlKey,
  PilotControlState,
  PilotApprovalRole,
  PilotReadinessStage,
  TransactionStatus,
  VerificationStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

export const ADMIN_ALERTS = Symbol('ADMIN_ALERTS');

const REQUIRED_PILOT_EVIDENCE = [
  'kyc',
  'provider',
  'security',
  'dpiaRetention',
  'reconciliation',
  'recovery',
  'observability',
  'incident',
  'customerJourney',
  'startRunbook',
  'pauseResumeRunbook',
  'permanentStopRunbook',
  'releaseEvidenceRunbook',
] as const;

const PilotApprovalAuthority = {
  ENGINEERING: 'ENGINEERING_LEAD_ID',
  OPERATIONS: 'OPS_LEAD_ID',
  COMPLIANCE_RISK: 'COMPLIANCE_RISK_APPROVER_ID',
  RECONCILIATION: 'RECONCILIATION_LEAD_ID',
  PILOT_OPERATOR: 'PILOT_OPERATOR_ID',
} as const;

export interface AdminAlertPort {
  sensitiveAction(
    name: string,
    details: Record<string, unknown>,
    auditEventId: string,
  ): Promise<void>;
}

type AdminActor = {
  id: string;
  userId: string;
  role: AdminRole;
  mfaVerifiedAt: Date | null;
  blockedAt: Date | null;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AUDIT_LOG_PORT) private readonly audit?: AuditLogPort,
    @Optional() private readonly worker?: WorkerJobProcessor,
    @Optional() private readonly beneficiaries?: BeneficiaryService,
    @Optional() private readonly profiles?: SenderProfileService,
    @Optional() @Inject(ADMIN_ALERTS) private readonly alerts?: AdminAlertPort,
    @Optional()
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection?: EnvelopeEncryptionService,
  ) {}

  /** Creates a short-lived self-hosted admin session after TOTP verification. */
  async login(userId: string, totpCode: string) {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { userId },
    });
    if (identity.blockedAt) throw new ForbiddenException('Identity is blocked');
    if (!identity.totpSecret || !this.verifyTotp(identity.totpSecret, totpCode))
      throw new UnauthorizedException('A valid TOTP code is required');

    const session = await this.createSession(
      identity.id,
      'TOTP',
      8 * 60 * 60 * 1000,
    );
    await this.record(identity, 'admin.login.mfa-verified', {
      target: `identity:${identity.id}`,
    });
    return session;
  }

  /** Establishes the same short-lived session after a verified WebAuthn ceremony. */
  async loginWithHardwareKey(identityId: string) {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { id: identityId },
    });
    if (identity.blockedAt) throw new ForbiddenException('Identity is blocked');
    const session = await this.createSession(
      identity.id,
      'WEBAUTHN',
      8 * 60 * 60 * 1000,
    );
    await this.record(identity, 'admin.login.hardware-key-verified', {
      target: `identity:${identity.id}`,
    });
    return session;
  }

  async actorFromSession(accessToken: string): Promise<AdminActor> {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: this.hashToken(accessToken) },
      include: { identity: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new UnauthorizedException('Admin session is invalid or expired');
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    return this.requireActor(session.identity.id, AdminRole.SUPPORT);
  }

  async sessionDetails(accessToken: string) {
    const actor = await this.actorFromSession(accessToken);
    const session = await this.prisma.adminSession.findUniqueOrThrow({
      where: { tokenHash: this.hashToken(accessToken) },
      select: {
        expiresAt: true,
        lastUsedAt: true,
        source: true,
      },
    });
    return {
      id: actor.id,
      userId: actor.userId,
      role: actor.role,
      mfaVerifiedAt: actor.mfaVerifiedAt,
      blockedAt: actor.blockedAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      source: session.source,
    };
  }

  async revokeSession(accessToken: string, reason = 'logout'): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { tokenHash: this.hashToken(accessToken), revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  csrfToken(accessToken: string): string {
    return createHmac(
      'sha256',
      process.env.ADMIN_CSRF_SECRET ?? 'change-me-in-production',
    )
      .update(`admin-csrf:${accessToken}`)
      .digest('base64url');
  }

  assertCsrfToken(accessToken: string, token: string | undefined): void {
    const expected = Buffer.from(this.csrfToken(accessToken));
    const actual = token ? Buffer.from(token) : Buffer.alloc(0);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ForbiddenException('A valid CSRF token is required');
  }

  private async createSession(
    identityId: string,
    source: string,
    lifetimeMs: number,
  ) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeMs);
    await this.prisma.$transaction([
      this.prisma.platformIdentity.update({
        where: { id: identityId },
        data: { mfaVerifiedAt: now },
      }),
      this.prisma.adminSession.create({
        data: {
          identityId,
          tokenHash: this.hashToken(token),
          expiresAt,
          source,
        },
      }),
    ]);
    return { accessToken: token, expiresAt };
  }

  async searchTransaction(
    actorId: string,
    reference: string,
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const transaction = await this.prisma.transferTransaction.findUnique({
      where: { reference },
    });
    return this.maskAdminData(transaction);
  }

  async revealSenderProfile(actorId: string, profileId: string) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!this.protection)
      throw new Error('Sensitive-data protection is not available');
    const profile = await this.prisma.senderProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: {
        id: true,
        email: true,
        emailCiphertext: true,
        senderPhoneNumber: true,
        senderPhoneCiphertext: true,
        whatsappPhoneNumber: true,
        backupPhoneNumber: true,
        backupPhoneCiphertext: true,
      },
    });
    const decrypt = async (
      ciphertext: string | null,
      purpose: string,
      legacy: string | null,
    ) =>
      ciphertext
        ? this.protection!.decrypt(JSON.parse(ciphertext), purpose)
        : legacy;
    const revealed = {
      id: profile.id,
      email: await decrypt(
        profile.emailCiphertext,
        'sender-email',
        profile.email,
      ),
      senderPhoneNumber: await decrypt(
        profile.senderPhoneCiphertext,
        'sender-phone',
        profile.senderPhoneNumber,
      ),
      whatsappPhoneNumber: await decrypt(
        profile.senderPhoneCiphertext,
        'sender-phone',
        profile.whatsappPhoneNumber ?? profile.senderPhoneNumber,
      ),
      backupPhoneNumber: await decrypt(
        profile.backupPhoneCiphertext,
        'sender-phone',
        profile.backupPhoneNumber,
      ),
    };
    await this.record(
      actor,
      'admin.sender-profile.sensitive-revealed',
      { target: `sender-profile:${profileId}`, fields: Object.keys(revealed) },
      true,
    );
    return revealed;
  }

  async dashboard(actorId: string): Promise<unknown> {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    const canOperate =
      actor.role === AdminRole.OPS || actor.role === AdminRole.ADMIN;
    const canAdminister = actor.role === AdminRole.ADMIN;
    const failed = canOperate
      ? await this.prisma.transferTransaction.findMany({
          where: { status: { in: ['COLLECTION_FAILED', 'PAYOUT_FAILED'] } },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        })
      : [];
    const pending = canOperate
      ? await this.prisma.transferTransaction.findMany({
          where: {
            status: {
              in: ['INITIATED', 'PENDING_COLLECTION', 'PENDING_PAYOUT'],
            },
          },
          orderBy: { updatedAt: 'asc' },
          take: 25,
        })
      : [];
    const reconciliation = canOperate
      ? await this.prisma.transactionReconciliation.findMany({
          where: {
            status: {
              in: [
                'MISMATCH',
                'MISSING_COLLECTION_ENTRY',
                'MISSING_PAYOUT_ENTRY',
              ],
            },
          },
          orderBy: { checkedAt: 'desc' },
          take: 25,
        })
      : [];
    const sensitiveActions = canOperate
      ? await this.prisma.auditEvent.findMany({
          where: { actorType: 'ADMIN' },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : [];
    const alerts = canOperate
      ? await this.prisma.adminAlertDelivery.findMany({
          orderBy: { updatedAt: 'desc' },
          take: 25,
        })
      : [];
    return {
      role: actor.role,
      failed: this.maskAdminData(failed),
      pending: this.maskAdminData(pending),
      reconciliation: this.maskAdminData(reconciliation),
      sensitiveActions: this.maskAdminData(sensitiveActions),
      alerts: this.maskAdminData(alerts),
      canAdminister,
    };
  }

  async searchOperations(
    actorId: string,
    query: { q?: string; status?: TransactionStatus; page?: number },
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const q = query.q?.trim();
    const phoneBlindIndex =
      q && this.protection
        ? await this.protection.blindIndex(q, 'beneficiary-phone')
        : undefined;
    const emailBlindIndex =
      q && this.protection
        ? await this.protection.blindIndex(q, 'sender-email')
        : undefined;
    const beneficiaryPhoneBlindIndex =
      q && this.protection
        ? await this.protection.blindIndex(q, 'sender-phone')
        : undefined;
    const profiles = q
      ? await this.prisma.senderProfile.findMany({
          where: {
            OR: [
              { userId: { contains: q, mode: 'insensitive' } },
              { legalName: { contains: q, mode: 'insensitive' } },
              ...(emailBlindIndex ? [{ emailBlindIndex }] : []),
              { email: { contains: q, mode: 'insensitive' } },
              ...(phoneBlindIndex
                ? [{ senderPhoneBlindIndex: phoneBlindIndex }]
                : []),
              // Legacy fallback only; new profiles do not populate this field.
              { senderPhoneNumber: { contains: q } },
            ],
          },
          select: { userId: true },
        })
      : [];
    const page = Math.max(query.page ?? 1, 1);
    const where = {
      status: query.status,
      OR: q
        ? [
            { reference: { contains: q, mode: 'insensitive' as const } },
            { senderUserId: { in: profiles.map((profile) => profile.userId) } },
            {
              beneficiary: {
                is: {
                  OR: [
                    {
                      displayName: {
                        contains: q,
                        mode: 'insensitive' as const,
                      },
                    },
                    { phoneNumber: { contains: q } },
                    ...(beneficiaryPhoneBlindIndex
                      ? [{ phoneNumberBlindIndex: beneficiaryPhoneBlindIndex }]
                      : []),
                  ],
                },
              },
            },
          ]
        : undefined,
    };
    const [transactions, total] = await Promise.all([
      this.prisma.transferTransaction.findMany({
        where,
        include: { beneficiary: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * 25,
        take: 25,
      }),
      this.prisma.transferTransaction.count({ where }),
    ]);
    return {
      items: this.maskAdminData(transactions),
      page,
      pageSize: 25,
      total,
    };
  }

  async listReconciliations(
    actorId: string,
    pagination: { page?: number; pageSize?: number } = {},
  ) {
    await this.requireActor(actorId, AdminRole.OPS);
    const page = Math.max(pagination.page ?? 1, 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const [rows, total] = await Promise.all([
      this.prisma.transactionReconciliation.findMany({
        orderBy: { checkedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { transaction: true },
      }),
      this.prisma.transactionReconciliation.count(),
    ]);
    return { items: this.maskAdminData(rows), page, pageSize, total };
  }

  async getReconciliation(actorId: string, id: string) {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const row = await this.prisma.transactionReconciliation.findUnique({
      where: { id },
      include: {
        transaction: true,
        adminNotes: {
          include: { author: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Reconciliation was not found');
    return this.maskAdminData(row);
  }

  async listAlerts(
    actorId: string,
    pagination: { page?: number; pageSize?: number } = {},
  ) {
    await this.requireActor(actorId, AdminRole.OPS);
    const page = Math.max(pagination.page ?? 1, 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const [rows, total] = await Promise.all([
      this.prisma.adminAlertDelivery.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminAlertDelivery.count(),
    ]);
    return { items: this.maskAdminData(rows), page, pageSize, total };
  }

  async auditTrail(
    actorId: string,
    pagination: { page?: number; pageSize?: number } = {},
  ) {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const page = Math.max(pagination.page ?? 1, 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count(),
    ]);
    return { items: this.maskAdminData(rows), page, pageSize, total };
  }

  async auditEvent(actorId: string, id: string) {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const row = await this.prisma.auditEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Audit event was not found');
    return this.maskAdminData(row);
  }

  async adminControls(actorId: string) {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const [controls, tier1, exposure, allowlistCount] = await Promise.all([
      this.prisma.pilotControl.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.tierLimitPolicy.findUnique({ where: { tier: 'TIER_1' } }),
      this.prisma.pilotExposurePolicy.findUnique({ where: { id: 'pilot' } }),
      this.prisma.pilotAllowlist.count({ where: { enabled: true } }),
    ]);
    return this.maskAdminData({ controls, tier1, exposure, allowlistCount });
  }

  async investigateTransfer(
    actorId: string,
    reference: string,
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference },
        include: {
          beneficiary: { include: { supersedes: true, revisions: true } },
          retryBeneficiary: true,
          workerJobs: { orderBy: { createdAt: 'desc' } },
          ledgerEntries: { orderBy: { createdAt: 'asc' } },
          reconciliation: {
            include: {
              adminNotes: {
                include: { author: true },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          adminNotes: {
            include: { author: true },
            orderBy: { createdAt: 'asc' },
          },
          auditEvents: { orderBy: { createdAt: 'asc' } },
        },
      },
    );
    const sender = await this.prisma.senderProfile.findUnique({
      where: { userId: transaction.senderUserId },
    });
    return {
      transaction: this.maskAdminData(transaction),
      sender: this.maskAdminData(sender),
    };
  }

  async addTransactionNote(actorId: string, reference: string, body: string) {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference },
      },
    );
    const note = await this.prisma.adminNote.create({
      data: { transactionId: transaction.id, authorIdentityId: actor.id, body },
    });
    await this.record(actor, 'admin.transaction.note.added', {
      target: `transaction:${transaction.id}`,
      noteId: note.id,
      body: note.body,
    });
    return note;
  }

  async addReconciliationNote(
    actorId: string,
    reconciliationId: string,
    body: string,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    const note = await this.prisma.adminNote.create({
      data: { reconciliationId, authorIdentityId: actor.id, body },
    });
    await this.record(actor, 'admin.reconciliation.note.added', {
      target: `reconciliation:${reconciliationId}`,
      noteId: note.id,
      body: note.body,
    });
    return note;
  }

  async acknowledgeAlert(actorId: string, alertId: string, reason: string) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!reason.trim())
      throw new ForbiddenException(
        'An alert acknowledgement reason is required',
      );
    const result = await this.prisma.adminAlertDelivery.updateMany({
      where: { id: alertId, acknowledgedAt: null },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedByIdentityId: actor.id,
      },
    });
    if (result.count === 0)
      return { id: alertId, handling: 'ALREADY_HANDLED' as const };
    await this.record(
      actor,
      'admin.alert.acknowledged',
      { target: `alert:${alertId}`, reason },
      true,
    );
    return { id: alertId, handling: 'ACCEPTED' as const };
  }

  async escalateAlert(actorId: string, alertId: string, reason: string) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!reason.trim())
      throw new ForbiddenException('An alert escalation reason is required');
    const result = await this.prisma.adminAlertDelivery.updateMany({
      where: { id: alertId, escalatedAt: null },
      data: {
        escalatedAt: new Date(),
        escalatedByIdentityId: actor.id,
      },
    });
    if (result.count === 0)
      return { id: alertId, handling: 'ALREADY_HANDLED' as const };
    await this.record(
      actor,
      'admin.alert.escalated',
      { target: `alert:${alertId}`, reason },
      true,
    );
    return { id: alertId, handling: 'ACCEPTED' as const };
  }

  async assignReconciliation(
    actorId: string,
    reconciliationId: string,
    ownerIdentityId: string,
    reason: string,
    escalate = false,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!reason.trim())
      throw new ForbiddenException(
        'A reconciliation ownership reason is required',
      );
    const owner = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { id: ownerIdentityId },
      select: { id: true, role: true, blockedAt: true },
    });
    if (owner.blockedAt)
      throw new ForbiddenException(
        'A blocked identity cannot own a discrepancy',
      );
    const reconciliation = await this.prisma.transactionReconciliation.update({
      where: { id: reconciliationId },
      data: {
        discrepancyOwnerIdentityId: owner.id,
        ...(escalate ? { escalatedAt: new Date() } : {}),
      },
    });
    await this.record(
      actor,
      escalate
        ? 'admin.reconciliation.escalated'
        : 'admin.reconciliation.owner-assigned',
      {
        target: `reconciliation:${reconciliationId}`,
        ownerIdentityId: owner.id,
        reason,
      },
      true,
    );
    return reconciliation;
  }

  /** Queues a durable partner status recheck and exposes that result immediately to operations. */
  async recheckStatus(
    actorId: string,
    reference: string,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference },
      },
    );
    const now = new Date();
    const result = 'QUEUED';
    const job = await this.prisma.workerJob.create({
      data: {
        dedupKey: `status-recheck:${transaction.id}:${idempotencyKey ?? now.getTime()}`,
        transactionReference: reference,
        transactionId: transaction.id,
        jobType: JobType.STATUS_RECHECK,
        payload: { requestedBy: actor.id },
      },
    });
    await this.prisma.transferTransaction.update({
      where: { id: transaction.id },
      data: { lastStatusRecheckAt: now, lastStatusRecheckResult: result },
    });
    await this.record(
      actor,
      'admin.transfer.status-recheck.queued',
      {
        target: `transaction:${transaction.id}`,
        jobId: job.id,
        result,
      },
      true,
    );
    return { job, result };
  }

  async queueReconciliation(actorId: string, reference: string) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference },
      },
    );
    const job = await this.prisma.workerJob.upsert({
      where: { dedupKey: `reconciliation:${transaction.id}` },
      create: {
        dedupKey: `reconciliation:${transaction.id}`,
        transactionReference: reference,
        transactionId: transaction.id,
        jobType: JobType.RECONCILIATION,
        payload: { requestedBy: actor.id },
      },
      update: { status: 'PENDING', lastError: null },
    });
    await this.record(
      actor,
      'admin.reconciliation.queued',
      {
        target: `transaction:${transaction.id}`,
        jobId: job.id,
      },
      true,
    );
    return job;
  }

  async retryFailedPayout(
    actorId: string,
    reference: string,
    correctedBeneficiaryId?: string,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!this.worker) throw new Error('Worker retry service is not available');
    const job = await this.worker.prepareManualPayoutRetry(
      reference,
      correctedBeneficiaryId,
    );
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference },
      },
    );
    await this.record(
      actor,
      'admin.transfer.payout-retry.prepared',
      {
        target: `transaction:${transaction.id}`,
        originalReference: reference,
        correctedBeneficiaryId,
      },
      true,
    );
    return job;
  }

  async reviewBeneficiaries(
    actorId: string,
    query: { search?: string; corridorId?: string; userId?: string },
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.OPS);
    const beneficiaries = this.beneficiaries
      ? await this.beneficiaries.reviewForOps(query)
      : await this.prisma.beneficiary.findMany({
          where: { corridorId: query.corridorId, userId: query.userId },
          orderBy: { createdAt: 'desc' },
        });
    return this.maskAdminData(beneficiaries);
  }

  async reviewBeneficiariesPage(
    actorId: string,
    query: {
      search?: string;
      corridorId?: string;
      userId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const all = (await this.reviewBeneficiaries(actorId, query)) as unknown[];
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: all.length,
    };
  }

  async reviewBeneficiary(actorId: string, id: string) {
    await this.requireActor(actorId, AdminRole.OPS);
    const beneficiary = this.beneficiaries
      ? await this.prisma.beneficiary.findUnique({
          where: { id },
          include: {
            supersedes: true,
            revisions: true,
            transactions: {
              select: { id: true, reference: true, status: true },
            },
            retryTransactions: {
              select: { id: true, reference: true, status: true },
            },
          },
        })
      : null;
    if (!beneficiary) throw new NotFoundException('Beneficiary was not found');
    return this.maskAdminData(beneficiary);
  }

  async setUserBlocked(
    actorId: string,
    userId: string,
    blocked: boolean,
    reason?: string,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.ADMIN);
    const identity = await this.prisma.platformIdentity.upsert({
      where: { userId },
      create: {
        userId,
        role: AdminRole.CUSTOMER,
        blockedAt: blocked ? new Date() : null,
        blockedById: actor.id,
        blockedReason: blocked ? (reason ?? 'Administrative action') : null,
      },
      update: {
        blockedAt: blocked ? new Date() : null,
        blockedById: actor.id,
        blockedReason: blocked ? (reason ?? 'Administrative action') : null,
      },
    });
    await this.record(
      actor,
      blocked ? 'admin.user.blocked' : 'admin.user.unblocked',
      {
        target: `identity:${identity.id}`,
        userId,
        reason,
      },
      true,
    );
    return identity;
  }

  async setTier1TransferCaps(
    actorId: string,
    perTransferLimitMinor: bigint,
    dailyLimitMinor: bigint,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.ADMIN);
    if (!this.profiles)
      throw new Error('Profile policy service is not available');
    const policy = await this.profiles.setGlobalTierLimits(
      'TIER_1',
      perTransferLimitMinor,
      dailyLimitMinor,
      actor.id,
    );
    await this.record(
      actor,
      'admin.policy.tier-1-caps.updated',
      {
        target: `tier-policy:${policy.id}`,
        perTransferLimitMinor: perTransferLimitMinor.toString(),
        dailyLimitMinor: dailyLimitMinor.toString(),
      },
      true,
    );
    return policy;
  }

  async setPilotControl(
    actorId: string,
    key: PilotControlKey,
    state: PilotControlState,
    reason: string,
  ) {
    if (!reason.trim())
      throw new ForbiddenException('A control reason is required');
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    const movementControlKeys = new Set<PilotControlKey>([
      PilotControlKey.GLOBAL,
      PilotControlKey.INITIATION,
      PilotControlKey.COLLECTION,
      PilotControlKey.PAYOUT,
      PilotControlKey.CORRIDOR_PROVIDER,
    ]);
    if (state === PilotControlState.ENABLED && movementControlKeys.has(key))
      await this.requirePublishedPilotReadiness();
    const pilotOperatorId = process.env.PILOT_OPERATOR_ID;
    const isPilotOperator = pilotOperatorId === actor.id;
    if (state === PilotControlState.PERMANENTLY_STOPPED) {
      if (!isPilotOperator)
        throw new ForbiddenException(
          'Only the accountable pilot operator may permanently stop the pilot',
        );
    } else if (!isPilotOperator && actor.role !== AdminRole.OPS) {
      throw new ForbiddenException('Only Ops may pause the pilot');
    }
    const control = await this.prisma.pilotControl.upsert({
      where: { key },
      create: { key, state, reason, changedByIdentityId: actor.id },
      update: {
        state,
        reason,
        changedByIdentityId: actor.id,
        changedAt: new Date(),
      },
    });
    await this.record(
      actor,
      `admin.pilot-control.${state.toLowerCase()}`,
      {
        target: `pilot-control:${key}`,
        key,
        state,
        reason,
      },
      true,
    );
    return control;
  }

  async recordPilotApproval(actorId: string, role: string, note: string) {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    if (!note.trim())
      throw new ForbiddenException('An approval note is required');
    const approvalRole = role as keyof typeof PilotApprovalAuthority;
    const requiredIdentity = PilotApprovalAuthority[approvalRole];
    if (!requiredIdentity || process.env[requiredIdentity] !== actor.id)
      throw new ForbiddenException(
        'The actor is not the configured approver for this readiness role',
      );
    const record = await this.prisma.pilotReleaseRecord.upsert({
      where: { id: 'pilot' },
      create: { id: 'pilot' },
      update: {},
    });
    const approval = await this.prisma.pilotReleaseApproval.upsert({
      where: { recordId_role: { recordId: record.id, role: role as never } },
      create: {
        recordId: record.id,
        role: role as never,
        actorIdentityId: actor.id,
        note,
      },
      update: {
        actorIdentityId: actor.id,
        note,
        approvedAt: new Date(),
      },
    });
    await this.record(
      actor,
      'admin.pilot-readiness.approval-recorded',
      { target: `pilot-release:${record.id}`, role, approvalId: approval.id },
      true,
    );
    return approval;
  }

  async recordPilotReadinessStage(
    actorId: string,
    stage: string,
    input: {
      evidenceRefs: Record<string, string>;
      approvedCohort?: Record<string, unknown>;
      numericLimits?: Record<string, unknown>;
      releaseConfiguration?: Record<string, unknown>;
      rollbackPlan?: string;
    },
  ) {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    if (
      stage !== PilotReadinessStage.FOUNDATION_COMPLETE &&
      stage !== PilotReadinessStage.LOCAL_E2E_COMPLETE
    )
      throw new ForbiddenException(
        'Pilot Ready must be published through the final release boundary',
      );
    const evidenceRefs = Object.fromEntries(
      Object.entries(input.evidenceRefs).filter(([, value]) =>
        isUsableEvidenceReference(value),
      ),
    );
    if (!Object.keys(evidenceRefs).length)
      throw new ForbiddenException('Stage evidence references are required');

    const requiredRoles: PilotApprovalRole[] =
      stage === PilotReadinessStage.FOUNDATION_COMPLETE
        ? [PilotApprovalRole.ENGINEERING]
        : [PilotApprovalRole.ENGINEERING, PilotApprovalRole.OPERATIONS];
    const authorizedStageActors = requiredRoles.map(
      (role) => process.env[PilotApprovalAuthority[role]],
    );
    if (!authorizedStageActors.includes(actor.id))
      throw new ForbiddenException(
        'The actor is not authorized to record this readiness stage',
      );
    const existingRecord = await this.prisma.pilotReleaseRecord.findUnique({
      where: { id: 'pilot' },
      include: { approvals: true, stageRecords: true },
    });
    const missingRoles = requiredRoles.filter(
      (role) =>
        !existingRecord?.approvals.some((approval) => approval.role === role),
    );
    if (missingRoles.length)
      throw new ForbiddenException(
        `Stage approvals are incomplete: ${missingRoles.join(', ')}`,
      );
    if (
      stage === PilotReadinessStage.LOCAL_E2E_COMPLETE &&
      !existingRecord?.stageRecords.some(
        (stageRecord) =>
          stageRecord.stage === PilotReadinessStage.FOUNDATION_COMPLETE,
      )
    )
      throw new ForbiddenException(
        'Foundation Complete evidence must be recorded before Local E2E Complete',
      );
    const record = await this.prisma.pilotReleaseRecord.upsert({
      where: { id: 'pilot' },
      create: { id: 'pilot', stage },
      update: {
        stage:
          this.readinessStageOrder(stage) >=
          this.readinessStageOrder(
            existingRecord?.stage ?? PilotReadinessStage.FOUNDATION_COMPLETE,
          )
            ? stage
            : undefined,
      },
    });
    const stageRecord = await this.prisma.pilotReadinessStageRecord.create({
      data: {
        recordId: record.id,
        stage,
        evidenceRefs,
        approvedCohort: input.approvedCohort as Prisma.InputJsonValue,
        numericLimits: input.numericLimits as Prisma.InputJsonValue,
        releaseConfiguration:
          input.releaseConfiguration as Prisma.InputJsonValue,
        rollbackPlan: input.rollbackPlan?.trim() || null,
        recordedByIdentityId: actor.id,
      },
    });
    await this.record(
      actor,
      'admin.pilot-readiness.stage-recorded',
      {
        target: `pilot-release:${record.id}`,
        stage,
        stageRecordId: stageRecord.id,
      },
      true,
    );
    return stageRecord;
  }

  async getPilotReadiness(actorId: string) {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const record = await this.prisma.pilotReleaseRecord.findUnique({
      where: { id: 'pilot' },
      include: {
        approvals: { orderBy: { approvedAt: 'asc' } },
        stageRecords: { orderBy: { recordedAt: 'asc' } },
      },
    });
    return this.maskAdminData(record);
  }

  async publishPilotReadiness(
    actorId: string,
    input: {
      approvedCohort: Record<string, unknown>;
      numericLimits: Record<string, unknown>;
      releaseConfiguration: Record<string, unknown>;
      rollbackPlan: string;
      evidenceRefs: Record<string, string>;
      noWaiverConfirmed: boolean;
    },
  ) {
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    if (process.env.PILOT_OPERATOR_ID !== actor.id)
      throw new ForbiddenException(
        'Only the accountable pilot operator may publish Pilot Ready',
      );
    if (!input.noWaiverConfirmed || !input.rollbackPlan.trim())
      throw new ForbiddenException(
        'Pilot Ready requires an explicit no-waiver declaration and rollback plan',
      );
    if (
      !Object.keys(input.approvedCohort).length ||
      !Object.keys(input.numericLimits).length ||
      !Object.keys(input.releaseConfiguration).length
    )
      throw new ForbiddenException(
        'Pilot Ready release configuration is incomplete',
      );
    const evidenceRefs = Object.fromEntries(
      Object.entries(input.evidenceRefs).filter(([, value]) =>
        isUsableEvidenceReference(value),
      ),
    );
    const missingEvidence = REQUIRED_PILOT_EVIDENCE.filter(
      (key) => !evidenceRefs[key],
    );
    if (missingEvidence.length)
      throw new ForbiddenException(
        `Pilot Ready evidence is incomplete: ${missingEvidence.join(', ')}`,
      );
    const existingRecord = await this.prisma.pilotReleaseRecord.findUnique({
      where: { id: 'pilot' },
      include: { approvals: true, stageRecords: true },
    });
    const missingApprovals = Object.keys(PilotApprovalAuthority).filter(
      (approvalRole) =>
        !existingRecord?.approvals.some(
          (approval) => approval.role === approvalRole,
        ),
    );
    if (missingApprovals.length)
      throw new ForbiddenException(
        `Pilot Ready approvals are incomplete: ${missingApprovals.join(', ')}`,
      );
    const hasStageEvidence = (stage: PilotReadinessStage) =>
      existingRecord?.stageRecords.some(
        (stageRecord) =>
          stageRecord.stage === stage &&
          Object.values(
            stageRecord.evidenceRefs as Record<string, unknown>,
          ).some(isUsableEvidenceReference),
      ) ?? false;
    if (!hasStageEvidence(PilotReadinessStage.FOUNDATION_COMPLETE))
      throw new ForbiddenException(
        'Foundation Complete evidence must be recorded before Pilot Ready',
      );
    if (!hasStageEvidence(PilotReadinessStage.LOCAL_E2E_COMPLETE))
      throw new ForbiddenException(
        'Local E2E Complete evidence must be recorded before Pilot Ready',
      );
    const publishedAt = new Date();
    const publishedByIdentityId = actor.id;
    const publicationHash = hashPilotReleasePublication({
      approvedCohort: input.approvedCohort,
      numericLimits: input.numericLimits,
      releaseConfiguration: input.releaseConfiguration,
      rollbackPlan: input.rollbackPlan,
      evidenceRefs,
      noWaiverConfirmed: input.noWaiverConfirmed,
      approvals: existingRecord?.approvals
        .map((approval) => ({
          role: approval.role,
          actorIdentityId: approval.actorIdentityId,
          note: approval.note,
          approvedAt: approval.approvedAt.toISOString(),
        }))
        .sort((left, right) => left.role.localeCompare(right.role)),
      stageRecords: existingRecord?.stageRecords
        .map((stageRecord) => ({
          id: stageRecord.id,
          stage: stageRecord.stage,
          evidenceRefs: stageRecord.evidenceRefs,
          approvedCohort: stageRecord.approvedCohort,
          numericLimits: stageRecord.numericLimits,
          releaseConfiguration: stageRecord.releaseConfiguration,
          rollbackPlan: stageRecord.rollbackPlan,
          noWaiverConfirmed: stageRecord.noWaiverConfirmed,
          recordedByIdentityId: stageRecord.recordedByIdentityId,
          recordedAt: stageRecord.recordedAt.toISOString(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      publishedAt: publishedAt.toISOString(),
      publishedByIdentityId,
    });
    const signingKey = process.env.PILOT_RELEASE_SIGNING_KEY;
    if (!signingKey)
      throw new ForbiddenException(
        'Pilot Ready requires the configured release signing key',
      );
    const publicationSignature = signPilotReleasePublication(
      publicationHash,
      signingKey,
    );
    const record = await this.prisma.pilotReleaseRecord.upsert({
      where: { id: 'pilot' },
      create: {
        id: 'pilot',
        stage: 'PILOT_READY',
        noWaiverConfirmed: true,
        approvedCohort: input.approvedCohort as Prisma.InputJsonValue,
        numericLimits: input.numericLimits as Prisma.InputJsonValue,
        releaseConfiguration:
          input.releaseConfiguration as Prisma.InputJsonValue,
        rollbackPlan: input.rollbackPlan,
        evidenceRefs,
        publicationHash,
        publicationSignature,
        publishedByIdentityId,
        publishedAt,
      },
      update: {
        stage: 'PILOT_READY',
        noWaiverConfirmed: true,
        approvedCohort: input.approvedCohort as Prisma.InputJsonValue,
        numericLimits: input.numericLimits as Prisma.InputJsonValue,
        releaseConfiguration:
          input.releaseConfiguration as Prisma.InputJsonValue,
        rollbackPlan: input.rollbackPlan,
        evidenceRefs,
        publicationHash,
        publicationSignature,
        publishedByIdentityId,
        publishedAt,
      },
      include: { approvals: true },
    });
    await this.record(
      actor,
      'admin.pilot-readiness.published',
      {
        target: `pilot-release:${record.id}`,
        stage: record.stage,
        publicationHash,
        evidenceKeys: Object.keys(evidenceRefs).sort(),
      },
      true,
    );
    return record;
  }

  async setPilotAllowlist(
    actorId: string,
    senderProfileId: string,
    enabled: boolean,
    reason: string,
  ) {
    if (!reason.trim())
      throw new ForbiddenException('An allowlist reason is required');
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    const entry = await this.prisma.pilotAllowlist.upsert({
      where: { senderProfileId },
      create: {
        senderProfileId,
        enabled,
        reason,
        changedByIdentityId: actor.id,
      },
      update: { enabled, reason, changedByIdentityId: actor.id },
    });
    await this.record(
      actor,
      enabled
        ? 'admin.pilot-allowlist.enabled'
        : 'admin.pilot-allowlist.disabled',
      {
        target: `sender-profile:${senderProfileId}`,
        senderProfileId,
        reason,
      },
      true,
    );
    return entry;
  }

  async setPilotExposurePolicy(
    actorId: string,
    input: {
      allowlistRequired?: boolean;
      maxPendingTransfers?: number | null;
      maxAmbiguousTransfers?: number | null;
      maxPartnerSettlementMinor?: bigint | null;
      maxRecoveryCapacity?: number | null;
      globalDailySendMinor?: bigint | null;
    },
  ) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    const policy = await this.prisma.pilotExposurePolicy.upsert({
      where: { id: 'pilot' },
      create: { id: 'pilot', ...input, updatedByIdentityId: actor.id },
      update: { ...input, updatedByIdentityId: actor.id },
    });
    await this.record(
      actor,
      'admin.pilot-exposure-policy.updated',
      {
        target: 'pilot-exposure-policy:pilot',
        values: input,
      },
      true,
    );
    return this.maskAdminData(policy);
  }

  async listVerificationCases(actorId: string) {
    await this.requireActor(actorId, AdminRole.OPS);
    const verifications = await this.prisma.senderVerification.findMany({
      where: {
        status: {
          in: [
            VerificationStatus.TECHNICAL_REVIEW,
            VerificationStatus.HUMAN_REVIEW,
          ],
        },
      },
      include: {
        senderProfile: {
          select: { id: true, legalName: true, tier: true, verifiedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return this.maskAdminData(verifications);
  }

  async listVerificationCasesPage(
    actorId: string,
    pagination: { page?: number; pageSize?: number } = {},
  ) {
    await this.requireActor(actorId, AdminRole.OPS);
    const page = Math.max(pagination.page ?? 1, 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const where = {
      status: {
        in: [
          VerificationStatus.TECHNICAL_REVIEW,
          VerificationStatus.HUMAN_REVIEW,
        ],
      },
    };
    const [verifications, total] = await Promise.all([
      this.prisma.senderVerification.findMany({
        where,
        include: {
          senderProfile: {
            select: { id: true, legalName: true, tier: true, verifiedAt: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.senderVerification.count({ where }),
    ]);
    return { items: this.maskAdminData(verifications), page, pageSize, total };
  }

  async verificationCase(actorId: string, id: string) {
    await this.requireActor(actorId, AdminRole.OPS);
    const verification = await this.prisma.senderVerification.findUnique({
      where: { id },
      include: {
        senderProfile: {
          select: { id: true, legalName: true, tier: true, verifiedAt: true },
        },
      },
    });
    if (!verification)
      throw new NotFoundException('Verification case was not found');
    return this.maskAdminData(verification);
  }

  async listAdminUsers(
    actorId: string,
    pagination: { page?: number; pageSize?: number } = {},
    search?: string,
  ) {
    await this.requireActor(actorId, AdminRole.ADMIN);
    const page = Math.max(pagination.page ?? 1, 1);
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 25, 1), 100);
    const where = search?.trim()
      ? {
          OR: [
            {
              userId: { contains: search.trim(), mode: 'insensitive' as const },
            },
            {
              displayName: {
                contains: search.trim(),
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.platformIdentity.findMany({
        where,
        select: {
          id: true,
          userId: true,
          displayName: true,
          role: true,
          blockedAt: true,
          blockedReason: true,
          mfaVerifiedAt: true,
        },
        orderBy: { userId: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.platformIdentity.count({ where }),
    ]);
    return { items: this.maskAdminData(rows), page, pageSize, total };
  }

  async adminUser(actorId: string, id: string) {
    await this.requireActor(actorId, AdminRole.ADMIN);
    const row = await this.prisma.platformIdentity.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        displayName: true,
        role: true,
        blockedAt: true,
        blockedReason: true,
        mfaVerifiedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Identity was not found');
    return this.maskAdminData(row);
  }

  /** Engineering may isolate provider movement, but has no resume or release authority. */
  async isolateProviderMovement(actorId: string, reason: string) {
    if (!reason.trim())
      throw new ForbiddenException('An isolation reason is required');
    const actor = await this.requireActor(actorId, AdminRole.SUPPORT);
    if (process.env.ENGINEERING_LEAD_ID !== actor.id)
      throw new ForbiddenException(
        'Only the configured engineering lead may execute technical isolation',
      );
    const control = await this.prisma.pilotControl.upsert({
      where: { key: PilotControlKey.CORRIDOR_PROVIDER },
      create: {
        key: PilotControlKey.CORRIDOR_PROVIDER,
        state: PilotControlState.PAUSED,
        reason,
        changedByIdentityId: actor.id,
      },
      update: {
        state: PilotControlState.PAUSED,
        reason,
        changedByIdentityId: actor.id,
        changedAt: new Date(),
      },
    });
    await this.record(
      actor,
      'admin.engineering-isolation.provider-paused',
      { target: 'pilot-control:CORRIDOR_PROVIDER', reason },
      true,
    );
    return control;
  }

  async reviewVerification(
    actorId: string,
    input: {
      verificationId: string;
      decision: Extract<
        VerificationStatus,
        'APPROVED' | 'REJECTED' | 'ESCALATED'
      >;
      decisionReason: string;
    },
  ) {
    const actor = await this.requireActor(actorId, AdminRole.OPS);
    if (!this.profiles)
      throw new Error('Profile review service is not available');
    const result =
      input.decision === VerificationStatus.APPROVED
        ? await this.profiles.approveVerification({
            verificationId: input.verificationId,
            reviewerIdentityId: actor.id,
            decisionReason: input.decisionReason,
          })
        : await this.profiles.resolveVerification({
            verificationId: input.verificationId,
            reviewerIdentityId: actor.id,
            decision: input.decision,
            decisionReason: input.decisionReason,
          });
    await this.record(
      actor,
      `admin.verification.${input.decision.toLowerCase()}`,
      {
        target: `verification:${input.verificationId}`,
        verificationId: input.verificationId,
        decision: input.decision,
      },
      true,
    );
    return result;
  }

  /** Emergency-only recovery path. It is intentionally separate from normal MFA login. */
  async useBreakGlass(
    userId: string,
    emergencySecret: string,
    reason = 'Emergency access',
  ) {
    const configuredSecret = process.env.BREAK_GLASS_SECRET;
    if (!configuredSecret || !this.safeEqual(configuredSecret, emergencySecret))
      throw new UnauthorizedException('Invalid break-glass credentials');
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { userId },
    });
    if (identity.role !== AdminRole.ADMIN)
      throw new ForbiddenException(
        'Break-glass is limited to admin identities',
      );
    const now = new Date();
    await this.prisma.platformIdentity.update({
      where: { id: identity.id },
      data: { breakGlassUsedAt: now, mfaVerifiedAt: now },
    });
    const session = await this.createSession(
      identity.id,
      'BREAK_GLASS',
      30 * 60 * 1000,
    );
    await this.record(
      identity,
      'admin.break-glass.used',
      {
        target: `identity:${identity.id}`,
        visible: true,
        reason,
      },
      true,
    );
    return session;
  }

  private async requireActor(
    actorId: string,
    required: AdminRole,
  ): Promise<AdminActor> {
    const actor = (await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { id: actorId },
    })) as AdminActor;
    if (actor.blockedAt) throw new ForbiddenException('Identity is blocked');
    if (!actor.mfaVerifiedAt)
      throw new UnauthorizedException('MFA is required');
    const rank: Record<AdminRole, number> = {
      CUSTOMER: 0,
      SUPPORT: 1,
      OPS: 2,
      ADMIN: 3,
    };
    if (rank[actor.role] < rank[required])
      throw new ForbiddenException(
        `${required.toLowerCase()} role is required`,
      );
    return actor;
  }

  private async requirePublishedPilotReadiness(): Promise<void> {
    const providerConfigurationReady =
      verifyPretiumRuntimeConfiguration(process.env).status === 'PASS';
    const keyLifecycleReady =
      verifyKeyLifecycle(process.env, undefined, true).status === 'PASS';
    const record = await this.prisma.pilotReleaseRecord.findUnique({
      where: { id: 'pilot' },
      include: {
        approvals: { orderBy: { approvedAt: 'asc' } },
        stageRecords: { orderBy: { recordedAt: 'asc' } },
      },
    });
    const recomputedPublicationHash = record
      ? hashPilotReleasePublication({
          approvedCohort: record.approvedCohort,
          numericLimits: record.numericLimits,
          releaseConfiguration: record.releaseConfiguration,
          rollbackPlan: record.rollbackPlan ?? '',
          evidenceRefs: record.evidenceRefs,
          noWaiverConfirmed: record.noWaiverConfirmed,
          approvals: record.approvals
            .map((approval) => ({
              role: approval.role,
              actorIdentityId: approval.actorIdentityId,
              note: approval.note,
              approvedAt: approval.approvedAt.toISOString(),
            }))
            .sort((left, right) => left.role.localeCompare(right.role)),
          stageRecords: record.stageRecords
            .map((stageRecord) => ({
              id: stageRecord.id,
              stage: stageRecord.stage,
              evidenceRefs: stageRecord.evidenceRefs,
              approvedCohort: stageRecord.approvedCohort,
              numericLimits: stageRecord.numericLimits,
              releaseConfiguration: stageRecord.releaseConfiguration,
              rollbackPlan: stageRecord.rollbackPlan,
              noWaiverConfirmed: stageRecord.noWaiverConfirmed,
              recordedByIdentityId: stageRecord.recordedByIdentityId,
              recordedAt: stageRecord.recordedAt.toISOString(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          publishedAt: record.publishedAt?.toISOString(),
          publishedByIdentityId: record.publishedByIdentityId ?? undefined,
        })
      : null;
    const publicationSignatureValid =
      recomputedPublicationHash !== null &&
      verifyPilotReleasePublicationSignature(
        recomputedPublicationHash,
        record?.publicationSignature,
        process.env.PILOT_RELEASE_SIGNING_KEY,
      );
    if (
      !record ||
      record.stage !== 'PILOT_READY' ||
      !record.noWaiverConfirmed ||
      !record.publishedAt ||
      !record.publishedByIdentityId ||
      record.publicationHash !== recomputedPublicationHash ||
      !publicationSignatureValid ||
      !providerConfigurationReady ||
      !keyLifecycleReady
    )
      throw new ForbiddenException(
        'Pilot Ready evidence and no-waiver approval are required before global start',
      );
  }

  private readinessStageOrder(stage: string): number {
    return (
      {
        [PilotReadinessStage.FOUNDATION_COMPLETE]: 1,
        [PilotReadinessStage.LOCAL_E2E_COMPLETE]: 2,
        [PilotReadinessStage.PILOT_READY]: 3,
      }[stage] ?? 0
    );
  }

  private async record(
    actor: AdminActor,
    name: string,
    payload: Record<string, unknown>,
    sensitive = false,
  ): Promise<void> {
    const auditEventId = crypto.randomUUID();
    await this.audit?.append({
      id: auditEventId,
      eventType: 'BUSINESS',
      name,
      actorType: 'ADMIN',
      actorId: actor.id,
      payload: { ...payload, actorRole: actor.role, actorUserId: actor.userId },
      createdAt: new Date(),
    });
    if (sensitive)
      await this.alerts?.sensitiveAction(
        name,
        {
          actorId: actor.id,
          ...payload,
        },
        auditEventId,
      );
  }

  private maskAdminData(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((entry) => this.maskAdminData(entry));
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (
          /ciphertext|payoutAccount|evidenceCiphertext|totpSecret|emergencySecret|tokenHash|accessToken|password|privateKey|publicKey|credentialId/i.test(
            key,
          )
        )
          return [[key, '[REDACTED]']];
        if (/lastError|stackTrace/i.test(key)) return [[key, '[REDACTED]']];
        if (
          /email|phone|legalName|providerReference|partnerReference/i.test(key)
        ) {
          return [
            [
              key,
              typeof entry === 'string'
                ? (this.protection?.mask(entry) ?? '[MASKED]')
                : '[REDACTED]',
            ],
          ];
        }
        return [[key, this.maskAdminData(entry)]];
      }),
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEqual(left: string, right: string): boolean {
    const leftHash = this.hashToken(left);
    const rightHash = this.hashToken(right);
    return timingSafeEqual(Buffer.from(leftHash), Buffer.from(rightHash));
  }

  private verifyTotp(secret: string, code: string, at = new Date()): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const key = this.decodeBase32(secret);
    for (const offset of [-1, 0, 1]) {
      const counter = Math.floor(at.getTime() / 30_000) + offset;
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64BE(BigInt(counter));
      const digest = createHmac('sha1', key).update(bytes).digest();
      const start = digest[digest.length - 1] & 0x0f;
      const value = (digest.readUInt32BE(start) & 0x7fffffff) % 1_000_000;
      if (this.safeEqual(value.toString().padStart(6, '0'), code)) return true;
    }
    return false;
  }

  private decodeBase32(value: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of value.replace(/=|\s/g, '').toUpperCase()) {
      const index = alphabet.indexOf(char);
      if (index < 0) throw new UnauthorizedException('Invalid TOTP secret');
      bits += index.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8)
      bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
    return Buffer.from(bytes);
  }
}
