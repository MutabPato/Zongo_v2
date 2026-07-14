import {
  ForbiddenException,
  Inject,
  Injectable,
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
import { WorkerJobProcessor } from '../../worker/src/worker-job.processor';
import { AdminRole, JobType, TransactionStatus } from '@prisma/client';

export const ADMIN_ALERTS = Symbol('ADMIN_ALERTS');

export interface AdminAlertPort {
  sensitiveAction(
    name: string,
    details: Record<string, unknown>,
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
  ) {}

  /** Creates a short-lived self-hosted admin session after TOTP verification. */
  async login(userId: string, totpCode: string) {
    const identity = await this.prisma.platformIdentity.findUniqueOrThrow({
      where: { userId },
    });
    if (identity.blockedAt) throw new ForbiddenException('Identity is blocked');
    if (!identity.totpSecret || !this.verifyTotp(identity.totpSecret, totpCode))
      throw new UnauthorizedException('A valid TOTP code is required');

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.platformIdentity.update({
        where: { id: identity.id },
        data: { mfaVerifiedAt: now },
      }),
      this.prisma.adminSession.create({
        data: {
          identityId: identity.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
        },
      }),
    ]);
    await this.record(identity, 'admin.login.mfa-verified', {
      target: `identity:${identity.id}`,
    });
    return {
      accessToken: token,
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    };
  }

  async actorFromSession(accessToken: string): Promise<AdminActor> {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: this.hashToken(accessToken) },
      include: { identity: true },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException('Admin session is invalid or expired');
    return this.requireActor(session.identity.id, AdminRole.SUPPORT);
  }

  async searchTransaction(
    actorId: string,
    reference: string,
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    return this.prisma.transferTransaction.findUnique({ where: { reference } });
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
      failed,
      pending,
      reconciliation,
      sensitiveActions,
      alerts,
      canAdminister,
    };
  }

  async searchOperations(
    actorId: string,
    query: { q?: string; status?: TransactionStatus; page?: number },
  ): Promise<unknown> {
    await this.requireActor(actorId, AdminRole.SUPPORT);
    const q = query.q?.trim();
    const profiles = q
      ? await this.prisma.senderProfile.findMany({
          where: {
            OR: [
              { userId: { contains: q, mode: 'insensitive' } },
              { legalName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { senderPhoneNumber: { contains: q } },
            ],
          },
          select: { userId: true },
        })
      : [];
    const page = Math.max(query.page ?? 1, 1);
    return this.prisma.transferTransaction.findMany({
      where: {
        status: query.status,
        OR: q
          ? [
              { reference: { contains: q, mode: 'insensitive' } },
              {
                senderUserId: { in: profiles.map((profile) => profile.userId) },
              },
              {
                beneficiary: {
                  is: {
                    OR: [
                      { displayName: { contains: q, mode: 'insensitive' } },
                      { phoneNumber: { contains: q } },
                    ],
                  },
                },
              },
            ]
          : undefined,
      },
      include: { beneficiary: true },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * 25,
      take: 25,
    });
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
    return { transaction, sender };
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

  /** Queues a durable partner status recheck and exposes that result immediately to operations. */
  async recheckStatus(actorId: string, reference: string): Promise<unknown> {
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
        dedupKey: `status-recheck:${transaction.id}:${now.getTime()}`,
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
    if (this.beneficiaries) return this.beneficiaries.reviewForOps(query);
    return this.prisma.beneficiary.findMany({
      where: { corridorId: query.corridorId, userId: query.userId },
      orderBy: { createdAt: 'desc' },
    });
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

  async setTier0TransferCaps(
    actorId: string,
    perTransferLimitMinor: bigint,
    dailyLimitMinor: bigint,
  ) {
    const actor = await this.requireActor(actorId, AdminRole.ADMIN);
    if (!this.profiles)
      throw new Error('Profile policy service is not available');
    const policy = await this.profiles.setGlobalTierLimits(
      'TIER_0',
      perTransferLimitMinor,
      dailyLimitMinor,
      actor.id,
    );
    await this.record(
      actor,
      'admin.policy.tier-0-caps.updated',
      {
        target: `tier-policy:${policy.id}`,
        perTransferLimitMinor: perTransferLimitMinor.toString(),
        dailyLimitMinor: dailyLimitMinor.toString(),
      },
      true,
    );
    return policy;
  }

  /** Emergency-only recovery path. It is intentionally separate from normal MFA login. */
  async useBreakGlass(userId: string, emergencySecret: string) {
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
    const token = randomBytes(32).toString('base64url');
    await this.prisma.adminSession.create({
      data: {
        identityId: identity.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    await this.record(
      identity,
      'admin.break-glass.used',
      {
        target: `identity:${identity.id}`,
        visible: true,
      },
      true,
    );
    return {
      accessToken: token,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    };
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

  private async record(
    actor: AdminActor,
    name: string,
    payload: Record<string, unknown>,
    sensitive = false,
  ): Promise<void> {
    await this.audit?.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name,
      actorType: 'ADMIN',
      actorId: actor.id,
      payload: { ...payload, actorRole: actor.role, actorUserId: actor.userId },
      createdAt: new Date(),
    });
    if (sensitive)
      await this.alerts?.sensitiveAction(name, {
        actorId: actor.id,
        ...payload,
      });
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
