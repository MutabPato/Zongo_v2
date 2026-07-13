import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_LOG_PORT, PARTNER_PORT } from '@app/domain';
import type { AuditLogPort, PartnerPort } from '@app/domain';
import { PrismaService as PrismaServiceToken } from '@app/db';
import type { PrismaService } from '@app/db';
import { JobType, JobStatus, Prisma, TransactionStatus } from '@prisma/client';

export interface WorkerJobInput {
  transactionReference: string;
  jobType: Extract<JobType, 'COLLECTION' | 'PAYOUT'>;
  payload: Prisma.InputJsonValue;
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

  constructor(
    @Inject(PrismaServiceToken) private readonly prisma: PrismaService,
    @Inject(PARTNER_PORT) private readonly partner: PartnerPort,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
  ) {}

  async process(job: WorkerJobInput): Promise<WorkerJobResult> {
    const dedupKey = `${job.transactionReference}:${job.jobType}`;
    const durableJob = await this.prisma.workerJob.upsert({
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
      const transaction =
        await this.prisma.transferTransaction.findUniqueOrThrow({
          where: { reference: job.transactionReference },
        });
      if (!transaction.beneficiaryId) {
        throw new Error('A beneficiary is required to process a transfer');
      }

      const beneficiaryId =
        job.jobType === JobType.PAYOUT && transaction.retryBeneficiaryId
          ? transaction.retryBeneficiaryId
          : transaction.beneficiaryId;
      const request = {
        reference: transaction.reference,
        amountMinor: transaction.sendAmountMinor,
        currency: transaction.sendCurrency,
        beneficiaryId,
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
        );
        return { skipped: false, status: 'FAILED' };
      }

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
      const transaction = await this.prisma.transferTransaction.findUnique({
        where: { reference: job.transactionReference },
      });
      if (transaction)
        await this.fail(durableJob.id, transaction, job.jobType, message);
      else await this.failJob(durableJob.id, message);
      return { skipped: false, status: 'FAILED' };
    }
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
    await this.prisma.transferTransaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.PENDING_PAYOUT,
        retryBeneficiaryId:
          correctedBeneficiaryId ?? transaction.retryBeneficiaryId,
        failedReason: null,
      },
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
    await this.prisma.transferTransaction.update({
      where: { id: transaction.id },
      data: { status, partnerReference },
    });
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

  private async fail(
    id: string,
    transaction: { id: string; corridorId: string },
    jobType: WorkerJobInput['jobType'],
    message: string,
  ): Promise<void> {
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
