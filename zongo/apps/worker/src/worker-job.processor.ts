import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AUDIT_LOG_PORT,
  DomainError,
  PARTNER_PORT,
  TransferLifecyclePolicy,
} from '@app/domain';
import type { AuditLogPort, PartnerPort } from '@app/domain';
import { PrismaService as PrismaServiceToken } from '@app/db';
import type { PrismaService } from '@app/db';
import { LedgerService } from '@app/ledger';
import {
  WHATSAPP_NOTIFIER,
  type WhatsAppNotificationPort,
} from '@app/whatsapp';
import { ENVELOPE_ENCRYPTION, EnvelopeEncryptionService } from '@app/security';
import {
  JobType,
  JobStatus,
  PilotControlKey,
  Prisma,
  TransactionStatus,
} from '@prisma/client';

export interface WorkerJobInput {
  transactionReference: string;
  jobType: Extract<
    JobType,
    | 'COLLECTION'
    | 'PAYOUT'
    | 'STATUS_RECHECK'
    | 'NOTIFICATION'
    | 'RECONCILIATION'
  >;
  payload: Prisma.InputJsonValue;
  /** Set by the dispatcher so the exact durable operational job is claimed. */
  persistedJobId?: string;
}

export type WorkerJobResult =
  | { readonly skipped: true; readonly reason: 'already-claimed' }
  | { readonly skipped: false; readonly status: 'SUCCEEDED' | 'FAILED' };

/**
 * Claims one durable job lease at a time. A lease expiry or FAILED status makes
 * the same transaction/job-type eligible for another worker to retry. Partner
 * calls use the immutable transaction reference as their idempotency reference.
 */
@Injectable()
export class WorkerJobProcessor {
  private readonly leaseMs = 60_000;
  private readonly lifecycle = new TransferLifecyclePolicy();

  constructor(
    @Inject(PrismaServiceToken) private readonly prisma: PrismaService,
    @Inject(PARTNER_PORT) private readonly partner: PartnerPort,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
    private readonly ledger: LedgerService,
    @Optional()
    @Inject(WHATSAPP_NOTIFIER)
    private readonly notifier?: WhatsAppNotificationPort,
    @Optional()
    @Inject(ENVELOPE_ENCRYPTION)
    private readonly protection?: EnvelopeEncryptionService,
  ) {}

  async process(job: WorkerJobInput): Promise<WorkerJobResult> {
    const dedupKey = `${job.transactionReference}:${job.jobType}`;
    const durableJob = job.persistedJobId
      ? { id: job.persistedJobId }
      : await this.prisma.workerJob.upsert({
          where: { dedupKey },
          create: {
            dedupKey,
            jobType: job.jobType,
            transactionReference: job.transactionReference,
            payload: job.payload,
          },
          update: {},
        });

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const claim = await this.prisma.workerJob.updateMany({
      where: {
        id: durableJob.id,
        OR: [
          { status: { in: [JobStatus.PENDING, JobStatus.FAILED] } },
          { status: JobStatus.RUNNING, leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: now,
        leaseExpiresAt,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (claim.count === 0) return { skipped: true, reason: 'already-claimed' };

    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'TECHNICAL',
      name: 'worker.job.claimed',
      payload: { dedupKey, attemptAt: now.toISOString() },
      createdAt: now,
    });

    try {
      if (job.jobType === JobType.NOTIFICATION) {
        const controls =
          (await this.prisma.pilotControl?.findMany({
            where: {
              key: {
                in: [PilotControlKey.GLOBAL, PilotControlKey.NOTIFICATION],
              },
            },
            select: { state: true },
          })) ?? [];
        if (controls.some((control) => control.state !== 'ENABLED')) {
          await this.prisma.workerJob.update({
            where: { id: durableJob.id },
            data: {
              status: JobStatus.PENDING,
              lastError:
                'Pilot notifications are paused by operational control',
              leaseExpiresAt: null,
            },
          });
          return { skipped: false, status: 'FAILED' };
        }
        await this.processNotification(durableJob.id, job.payload);
        return { skipped: false, status: 'SUCCEEDED' };
      }
      if (
        job.jobType === JobType.COLLECTION ||
        job.jobType === JobType.PAYOUT
      ) {
        const controlKeys: PilotControlKey[] = [
          PilotControlKey.GLOBAL,
          job.jobType === JobType.COLLECTION
            ? PilotControlKey.COLLECTION
            : PilotControlKey.PAYOUT,
        ];
        const controls =
          (await this.prisma.pilotControl?.findMany({
            where: { key: { in: controlKeys } },
            select: { key: true, state: true },
          })) ?? [];
        if (controls.some((control) => control.state !== 'ENABLED')) {
          const reason =
            'Pilot money movement is paused by operational control';
          await this.prisma.workerJob.update({
            where: { id: durableJob.id },
            data: {
              status: JobStatus.PENDING,
              lastError: reason,
              leaseExpiresAt: null,
            },
          });
          await this.audit.append({
            id: crypto.randomUUID(),
            eventType: 'TECHNICAL',
            name: 'worker.job.paused-by-operational-control',
            payload: {
              jobType: job.jobType,
              transactionReference: job.transactionReference,
            },
            createdAt: new Date(),
          });
          return { skipped: false, status: 'FAILED' };
        }
      }
      const transaction =
        await this.prisma.transferTransaction.findUniqueOrThrow({
          where: { reference: job.transactionReference },
          include: { beneficiary: true, retryBeneficiary: true },
        });
      if (job.jobType === JobType.RECONCILIATION) {
        await this.ledger.persistReconciliation(transaction.id);
        await this.prisma.workerJob.update({
          where: { id: durableJob.id },
          data: {
            status: JobStatus.SUCCEEDED,
            processedAt: new Date(),
            leaseExpiresAt: null,
          },
        });
        return { skipped: false, status: 'SUCCEEDED' };
      }
      if (job.jobType === JobType.STATUS_RECHECK) {
        const result = await this.partner.status(
          transaction.partnerReference ?? transaction.reference,
          transaction.status === TransactionStatus.PENDING_PAYOUT
            ? 'PAYOUT'
            : 'COLLECTION',
        );
        if (!result.success) {
          await this.prisma.$transaction([
            this.prisma.transferTransaction.update({
              where: { id: transaction.id },
              data: {
                lastStatusRecheckAt: new Date(),
                lastStatusRecheckResult: `FAILED:${result.error.code}`,
              },
            }),
            this.prisma.workerJob.update({
              where: { id: durableJob.id },
              data: {
                status: JobStatus.FAILED,
                lastError: result.error.message,
                leaseExpiresAt: null,
              },
            }),
          ]);
          await this.audit.append({
            id: crypto.randomUUID(),
            eventType: 'BUSINESS',
            name: 'admin.transfer.status-recheck.failed',
            transactionId: transaction.id,
            corridorId: transaction.corridorId,
            payload: {
              reference: transaction.reference,
              reason: result.error.message,
            },
            createdAt: new Date(),
          });
          return { skipped: false, status: 'FAILED' };
        }
        this.lifecycle.assertTransition(transaction.status, result.status);
        await this.prisma.$transaction([
          this.prisma.transferTransaction.update({
            where: { id: transaction.id },
            data: {
              status: result.status,
              partnerReference: result.partnerReference,
              lastStatusRecheckAt: new Date(),
              lastStatusRecheckResult: result.status,
            },
          }),
          this.prisma.workerJob.update({
            where: { id: durableJob.id },
            data: {
              status: JobStatus.SUCCEEDED,
              processedAt: new Date(),
              leaseExpiresAt: null,
            },
          }),
        ]);
        await this.recordLifecycleSuccess(transaction.id, result.status);
        await this.resolveWaitingSession(transaction.id, result.status);
        await this.audit.append({
          id: crypto.randomUUID(),
          eventType: 'BUSINESS',
          name: 'admin.transfer.status-recheck.completed',
          transactionId: transaction.id,
          corridorId: transaction.corridorId,
          payload: {
            reference: transaction.reference,
            result: result.status,
            partnerReference: result.partnerReference,
          },
          createdAt: new Date(),
        });
        return { skipped: false, status: 'SUCCEEDED' };
      }
      const processingStatus =
        job.jobType === JobType.COLLECTION
          ? TransactionStatus.PENDING_COLLECTION
          : TransactionStatus.PENDING_PAYOUT;
      this.lifecycle.assertTransition(transaction.status, processingStatus);
      if (transaction.status !== processingStatus) {
        await this.prisma.transferTransaction.update({
          where: { id: transaction.id },
          data: { status: processingStatus },
        });
      }
      if (!transaction.beneficiaryId) {
        throw new Error('A beneficiary is required to process a transfer');
      }

      const beneficiaryId =
        job.jobType === JobType.PAYOUT && transaction.retryBeneficiaryId
          ? transaction.retryBeneficiaryId
          : transaction.beneficiaryId;
      const beneficiary =
        job.jobType === JobType.PAYOUT && transaction.retryBeneficiary
          ? transaction.retryBeneficiary
          : transaction.beneficiary;
      let senderPhoneNumber: string | undefined;
      if (job.jobType === JobType.COLLECTION && this.protection) {
        const metadata = (transaction.metadata ?? {}) as Record<
          string,
          unknown
        >;
        if (typeof metadata.senderProfileId === 'string') {
          const sender = await this.prisma.senderProfile?.findUnique({
            where: { id: metadata.senderProfileId },
            select: { senderPhoneNumber: true, senderPhoneCiphertext: true },
          });
          senderPhoneNumber =
            sender?.senderPhoneNumber ??
            (sender?.senderPhoneCiphertext
              ? await this.protection.decrypt(
                  JSON.parse(sender.senderPhoneCiphertext),
                  'sender-phone',
                )
              : undefined);
        }
      }
      let payoutAccount: Record<string, unknown> | undefined;
      if (
        job.jobType === JobType.PAYOUT &&
        beneficiary?.payoutAccountCiphertext &&
        this.protection
      ) {
        payoutAccount = JSON.parse(
          await this.protection.decrypt(
            JSON.parse(beneficiary.payoutAccountCiphertext as string),
            'beneficiary-payout-account',
          ),
        ) as Record<string, unknown>;
      }
      if (
        job.jobType === JobType.PAYOUT &&
        (transaction.payoutAmountMinor === null ||
          transaction.payoutCurrency === null)
      )
        throw new Error('Payout money is required to process a payout');
      const request = {
        reference: transaction.reference,
        amountMinor:
          job.jobType === JobType.COLLECTION
            ? transaction.sendAmountMinor
            : transaction.payoutAmountMinor!,
        currency:
          job.jobType === JobType.COLLECTION
            ? transaction.sendCurrency
            : transaction.payoutCurrency!,
        beneficiaryId,
        ...(senderPhoneNumber ? { senderPhoneNumber } : {}),
        ...(beneficiary?.phoneNumber
          ? { payoutPhoneNumber: beneficiary.phoneNumber }
          : {}),
        ...(payoutAccount ? { payoutAccount } : {}),
        mobileNetwork: process.env.PRETIUM_MOBILE_NETWORK,
      };
      const result =
        job.jobType === JobType.COLLECTION
          ? await this.partner.collect(request)
          : await this.partner.payout(request);

      if (!result.success) {
        await this.fail(
          durableJob.id,
          transaction,
          job.jobType,
          result.error.message,
          result.error.retryable,
        );
        return { skipped: false, status: 'FAILED' };
      }

      const succeededStatus =
        job.jobType === JobType.COLLECTION
          ? TransactionStatus.COLLECTION_SUCCESS
          : TransactionStatus.PAYOUT_SUCCESS;
      this.lifecycle.assertTransition(processingStatus, succeededStatus);

      await this.ledger.appendLifecycleEntries(
        transaction.id,
        job.jobType === JobType.COLLECTION ? 'collection' : 'payout',
      );

      await this.prisma.$transaction([
        this.prisma.transferTransaction.update({
          where: { id: transaction.id },
          data:
            job.jobType === JobType.COLLECTION
              ? {
                  status: 'COLLECTION_SUCCESS',
                  collectionCompletedAt: new Date(),
                  partnerReference: result.partnerReference,
                }
              : {
                  status: 'PAYOUT_SUCCESS',
                  payoutCompletedAt: new Date(),
                  partnerReference: result.partnerReference,
                },
        }),
        this.prisma.workerJob.update({
          where: { id: durableJob.id },
          data: {
            status: JobStatus.SUCCEEDED,
            processedAt: new Date(),
            leaseExpiresAt: null,
          },
        }),
      ]);
      await this.ledger.persistReconciliation(transaction.id);
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'BUSINESS',
        name: `transfer.${job.jobType.toLowerCase()}.succeeded`,
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: {
          reference: transaction.reference,
          partnerReference: result.partnerReference,
        },
        createdAt: new Date(),
      });
      return { skipped: false, status: 'SUCCEEDED' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Worker execution failed';
      if (job.jobType === JobType.NOTIFICATION) {
        await this.failJob(durableJob.id, message);
        return { skipped: false, status: 'FAILED' };
      }
      const transaction = await this.prisma.transferTransaction.findUnique({
        where: { reference: job.transactionReference },
      });
      if (error instanceof DomainError) {
        await this.failJob(durableJob.id, message);
        if (transaction)
          await this.audit.append({
            id: crypto.randomUUID(),
            eventType: 'TECHNICAL',
            name: 'worker.job.invalid-transition',
            transactionId: transaction.id,
            corridorId: transaction.corridorId,
            payload: { jobType: job.jobType, reason: message },
            createdAt: new Date(),
          });
        return { skipped: false, status: 'FAILED' };
      }
      if (transaction)
        await this.fail(durableJob.id, transaction, job.jobType, message);
      else await this.failJob(durableJob.id, message);
      return { skipped: false, status: 'FAILED' };
    }
  }

  private async processNotification(
    jobId: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    if (!this.notifier || !this.protection)
      throw new Error('WhatsApp notification dependencies are not configured');
    const notificationIntentId =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).notificationIntentId
        : undefined;
    if (typeof notificationIntentId !== 'string')
      throw new Error('Notification intent id is required');
    const intent = await this.prisma.notificationIntent.findUniqueOrThrow({
      where: { id: notificationIntentId },
    });
    if (!intent.recipientPhoneCiphertext)
      throw new Error('Notification recipient is unavailable');
    const recipient = await this.protection.decrypt(
      JSON.parse(intent.recipientPhoneCiphertext),
      'sender-phone',
    );
    try {
      await this.notifier.send({
        recipientPhoneNumber: recipient,
        template: intent.template,
        payload: intent.payload as Record<string, unknown>,
      });
      await this.prisma.$transaction([
        this.prisma.notificationIntent.update({
          where: { id: intent.id },
          data: { status: 'SENT', sentAt: new Date() },
        }),
        this.prisma.workerJob.update({
          where: { id: jobId },
          data: {
            status: JobStatus.SUCCEEDED,
            processedAt: new Date(),
            leaseExpiresAt: null,
          },
        }),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Notification failed';
      const attempts = intent.attempts + 1;
      const delayMs = Math.min(3_600_000, 1_000 * 2 ** Math.min(attempts, 10));
      await this.prisma.$transaction([
        this.prisma.notificationIntent.update({
          where: { id: intent.id },
          data: {
            status: 'FAILED',
            attempts,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + delayMs),
          },
        }),
        this.prisma.workerJob.update({
          where: { id: jobId },
          data: {
            status: JobStatus.FAILED,
            lastError: message,
            leaseExpiresAt: null,
          },
        }),
      ]);
      throw error;
    }
  }

  private async resolveWaitingSession(
    transactionId: string,
    status: TransactionStatus,
  ): Promise<void> {
    if (
      status !== TransactionStatus.COLLECTION_SUCCESS &&
      status !== TransactionStatus.COLLECTION_FAILED &&
      status !== TransactionStatus.PAYOUT_SUCCESS &&
      status !== TransactionStatus.PAYOUT_FAILED
    )
      return;
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { transferId: transactionId },
    });
    if (!session || session.status !== 'WAITING') return;
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { id: transactionId } },
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppSession.update({
        where: { id: session.id },
        data: { status: 'CLOSED', activeChatKey: null },
      });
      const intent = await tx.notificationIntent.upsert({
        where: { dedupKey: `transfer:${transaction.id}:resolved` },
        create: {
          dedupKey: `transfer:${transaction.id}:resolved`,
          transactionId: transaction.id,
          channel: 'WHATSAPP',
          recipientPhoneCiphertext: session.senderPhoneCiphertext,
          template: 'transfer.resolved',
          payload: { status, reference: transaction.reference },
        },
        update: {},
      });
      await tx.workerJob.upsert({
        where: { dedupKey: `notification:${intent.id}` },
        create: {
          dedupKey: `notification:${intent.id}`,
          jobType: 'NOTIFICATION',
          transactionReference: transaction.reference,
          transactionId: transaction.id,
          payload: { notificationIntentId: intent.id },
        },
        update: {},
      });
    });
  }

  /** Explicit support action; no automatic refund or automatic payout retry exists. */
  async prepareManualPayoutRetry(
    transactionReference: string,
    correctedBeneficiaryId?: string,
  ): Promise<WorkerJobInput> {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      {
        where: { reference: transactionReference },
      },
    );
    if (transaction.status !== TransactionStatus.PAYOUT_FAILED) {
      throw new Error('Only a failed payout can be manually retried');
    }
    this.lifecycle.assertTransition(
      transaction.status,
      TransactionStatus.PENDING_PAYOUT,
      { reason: 'MANUAL_PAYOUT_RETRY' },
    );
    const job = await this.prisma.$transaction(async (database) => {
      const retryClaim = await database.transferTransaction.updateMany({
        where: {
          id: transaction.id,
          status: TransactionStatus.PAYOUT_FAILED,
        },
        data: {
          status: TransactionStatus.PENDING_PAYOUT,
          retryBeneficiaryId:
            correctedBeneficiaryId ?? transaction.retryBeneficiaryId,
          failedReason: null,
        },
      });
      if (retryClaim.count !== 1)
        throw new DomainError(
          'PAYOUT_RETRY_ALREADY_PREPARED',
          'A manual payout retry has already been prepared',
        );
      return database.workerJob.create({
        data: {
          dedupKey: `manual-payout-retry:${transaction.id}:${Date.now()}`,
          transactionReference: transaction.reference,
          transactionId: transaction.id,
          jobType: JobType.PAYOUT,
          payload: {
            manual: true,
            originalTransactionId: transaction.id,
            correctedBeneficiaryId:
              correctedBeneficiaryId ?? transaction.retryBeneficiaryId,
          },
        },
      });
    });
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name: 'transfer.payout.manual-retry.prepared',
      transactionId: transaction.id,
      corridorId: transaction.corridorId,
      payload: {
        reference: transaction.reference,
        retryBeneficiaryId:
          correctedBeneficiaryId ?? transaction.retryBeneficiaryId,
      },
      createdAt: new Date(),
    });
    return {
      transactionReference: transaction.reference,
      jobType: JobType.PAYOUT,
      payload: { manual: true },
      persistedJobId: job.id,
    };
  }

  async handlePartnerCallback(
    transactionReference: string,
    status: TransactionStatus,
    partnerReference: string,
  ): Promise<{ applied: boolean }> {
    const transaction = await this.prisma.transferTransaction.findUniqueOrThrow(
      { where: { reference: transactionReference } },
    );
    const closed = (
      [
        TransactionStatus.COLLECTION_FAILED,
        TransactionStatus.PAYOUT_FAILED,
        TransactionStatus.PAYOUT_SUCCESS,
      ] as TransactionStatus[]
    ).includes(transaction.status);
    if (closed) {
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'TECHNICAL',
        name: 'transfer.callback.late',
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: { receivedStatus: status, partnerReference },
        createdAt: new Date(),
      });
      return { applied: false };
    }
    if (transaction.status === status) {
      if (transaction.partnerReference === partnerReference) {
        await this.audit.append({
          id: crypto.randomUUID(),
          eventType: 'TECHNICAL',
          name: 'transfer.callback.duplicate',
          transactionId: transaction.id,
          corridorId: transaction.corridorId,
          payload: { status, partnerReference },
          createdAt: new Date(),
        });
        return { applied: false };
      }
      throw new DomainError(
        'PARTNER_CALLBACK_CONFLICT',
        'A callback conflicts with the existing partner reference',
      );
    }
    this.lifecycle.assertTransition(transaction.status, status);
    await this.prisma.transferTransaction.update({
      where: { id: transaction.id },
      data: { status, partnerReference },
    });
    await this.recordLifecycleSuccess(transaction.id, status);
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name: 'transfer.callback.applied',
      transactionId: transaction.id,
      corridorId: transaction.corridorId,
      payload: { status, partnerReference },
      createdAt: new Date(),
    });
    return { applied: true };
  }

  private async recordLifecycleSuccess(
    transactionId: string,
    status: TransactionStatus,
  ): Promise<void> {
    const eventName =
      status === TransactionStatus.COLLECTION_SUCCESS
        ? 'collection'
        : status === TransactionStatus.PAYOUT_SUCCESS
          ? 'payout'
          : undefined;
    if (!eventName) return;
    await this.ledger.appendLifecycleEntries(transactionId, eventName);
    await this.ledger.persistReconciliation(transactionId);
  }

  private async fail(
    id: string,
    transaction: { id: string; corridorId: string },
    jobType: WorkerJobInput['jobType'],
    message: string,
    retryable = false,
  ): Promise<void> {
    if (jobType === JobType.COLLECTION && retryable) {
      await this.prisma.workerJob.update({
        where: { id },
        data: {
          status: JobStatus.FAILED,
          lastError: message,
          leaseExpiresAt: null,
        },
      });
      await this.audit.append({
        id: crypto.randomUUID(),
        eventType: 'TECHNICAL',
        name: 'transfer.collection.retryable-failure',
        transactionId: transaction.id,
        corridorId: transaction.corridorId,
        payload: { failureReason: message },
        createdAt: new Date(),
      });
      return;
    }
    const status =
      jobType === JobType.COLLECTION
        ? TransactionStatus.COLLECTION_FAILED
        : TransactionStatus.PAYOUT_FAILED;
    await this.prisma.$transaction([
      this.prisma.transferTransaction.update({
        where: { id: transaction.id },
        data: { status, failedReason: message },
      }),
      this.prisma.workerJob.update({
        where: { id },
        data: {
          status: JobStatus.FAILED,
          lastError: message,
          leaseExpiresAt: null,
        },
      }),
    ]);
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'BUSINESS',
      name: `transfer.${jobType.toLowerCase()}.failed`,
      transactionId: transaction.id,
      corridorId: transaction.corridorId,
      payload: { failureReason: message },
      createdAt: new Date(),
    });
  }

  private async failJob(id: string, message: string): Promise<void> {
    await this.prisma.workerJob.update({
      where: { id },
      data: {
        status: JobStatus.FAILED,
        lastError: message,
        leaseExpiresAt: null,
      },
    });
  }
}
