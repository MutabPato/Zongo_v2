import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { JobStatus, JobType, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '@app/db';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { WorkerJobProcessor } from './worker-job.processor';
import { PilotExposureMonitor } from './pilot-exposure-monitor.service';

/** Polls the database-backed queue; claims in WorkerJobProcessor prevent races. */
@Injectable()
export class DurableJobDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastReconciliationSweepAt = 0;
  private lastStatusRecheckSweepAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WorkerJobProcessor,
    @Optional() private readonly monitor?: PilotExposureMonitor,
    @Optional() @Inject(AUDIT_LOG_PORT) private readonly audit?: AuditLogPort,
  ) {}

  onModuleInit(): void {
    const interval = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
    this.timer = setInterval(() => void this.dispatch(), interval);
    void this.dispatch();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.monitor?.evaluate();
      const reconciliationSweep = await this.enqueueReconciliationSweep();
      await this.enqueuePendingStatusRechecks();
      const reconciliationResults: Array<
        Awaited<ReturnType<WorkerJobProcessor['process']>>
      > = [];
      const jobs = await this.prisma.workerJob.findMany({
        where: {
          jobType: {
            in: [
              JobType.COLLECTION,
              JobType.PAYOUT,
              JobType.STATUS_RECHECK,
              JobType.NOTIFICATION,
              JobType.RECONCILIATION,
            ],
          },
          OR: [
            { status: JobStatus.PENDING },
            {
              status: JobStatus.FAILED,
              jobType: {
                in: [
                  JobType.COLLECTION,
                  JobType.STATUS_RECHECK,
                  JobType.NOTIFICATION,
                  JobType.RECONCILIATION,
                ],
              },
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const job of jobs) {
        if (job.jobType === JobType.PAYOUT && job.status === JobStatus.FAILED)
          continue;
        const result = await this.processor.process({
          persistedJobId: job.id,
          transactionReference: job.transactionReference,
          jobType: job.jobType as Extract<
            JobType,
            | 'COLLECTION'
            | 'PAYOUT'
            | 'STATUS_RECHECK'
            | 'NOTIFICATION'
            | 'RECONCILIATION'
          >,
          payload: job.payload as Prisma.InputJsonValue,
        });
        if (job.jobType === JobType.RECONCILIATION)
          reconciliationResults.push(result);
      }
      if (reconciliationSweep && this.audit)
        await this.audit.append({
          id: crypto.randomUUID(),
          eventType: 'TECHNICAL',
          name: 'reconciliation.sweep.completed',
          payload: {
            bucket: reconciliationSweep.bucket,
            eligibleTransactions: reconciliationSweep.eligibleTransactions,
            jobsObserved: reconciliationResults.length,
            succeeded: reconciliationResults.filter(
              (result) => !result.skipped && result.status === 'SUCCEEDED',
            ).length,
            failed: reconciliationResults.filter(
              (result) => !result.skipped && result.status === 'FAILED',
            ).length,
            skipped: reconciliationResults.filter((result) => result.skipped)
              .length,
          },
          createdAt: new Date(),
        });
    } finally {
      this.running = false;
    }
  }

  private async enqueueReconciliationSweep(): Promise<{
    bucket: number;
    eligibleTransactions: number;
  } | null> {
    const intervalMs = Number(
      process.env.RECONCILIATION_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000,
    );
    const now = Date.now();
    if (now - this.lastReconciliationSweepAt < intervalMs) return null;
    const transactions = await this.prisma.transferTransaction?.findMany?.({
      where: {
        status: {
          in: [
            TransactionStatus.COLLECTION_SUCCESS,
            TransactionStatus.PENDING_PAYOUT,
            TransactionStatus.PAYOUT_SUCCESS,
            TransactionStatus.COLLECTION_FAILED,
            TransactionStatus.PAYOUT_FAILED,
          ],
        },
      },
      select: { id: true, reference: true },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });
    if (!transactions) return null;
    this.lastReconciliationSweepAt = now;
    const bucket = Math.floor(now / intervalMs);
    await this.prisma.$transaction(
      transactions.map((transaction) =>
        this.prisma.workerJob.upsert({
          where: {
            dedupKey: `reconciliation:${transaction.id}:${bucket}`,
          },
          create: {
            dedupKey: `reconciliation:${transaction.id}:${bucket}`,
            transactionReference: transaction.reference,
            transactionId: transaction.id,
            jobType: JobType.RECONCILIATION,
            payload: { reason: 'CADENCE_SWEEP', bucket },
          },
          update: {},
        }),
      ),
    );
    return { bucket, eligibleTransactions: transactions.length };
  }

  /**
   * Pretium callbacks are at-least-once hints and may be missing. Pending
   * provider work therefore gets a durable status lookup on a bounded cadence.
   */
  private async enqueuePendingStatusRechecks(): Promise<void> {
    const intervalMs = Number(
      process.env.STATUS_RECHECK_SWEEP_INTERVAL_MS ?? 60 * 1000,
    );
    const now = Date.now();
    if (now - this.lastStatusRecheckSweepAt < intervalMs) return;
    const transactions = await this.prisma.transferTransaction?.findMany?.({
      where: {
        status: {
          in: [
            TransactionStatus.PENDING_COLLECTION,
            TransactionStatus.PENDING_PAYOUT,
          ],
        },
      },
      select: { id: true, reference: true },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });
    if (!transactions) return;
    this.lastStatusRecheckSweepAt = now;
    const bucket = Math.floor(now / intervalMs);
    await this.prisma.$transaction(
      transactions.map((transaction) =>
        this.prisma.workerJob.upsert({
          where: {
            dedupKey: `provider-status:${transaction.id}:${bucket}`,
          },
          create: {
            dedupKey: `provider-status:${transaction.id}:${bucket}`,
            transactionReference: transaction.reference,
            transactionId: transaction.id,
            jobType: JobType.STATUS_RECHECK,
            payload: { reason: 'PENDING_PROVIDER_SWEEP', bucket },
          },
          update: {},
        }),
      ),
    );
  }
}
