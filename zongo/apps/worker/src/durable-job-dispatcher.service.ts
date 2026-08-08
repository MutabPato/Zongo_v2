import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { JobStatus, JobType, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '@app/db';
import { WorkerJobProcessor } from './worker-job.processor';
import { PilotExposureMonitor } from './pilot-exposure-monitor.service';

/** Polls the database-backed queue; claims in WorkerJobProcessor prevent races. */
@Injectable()
export class DurableJobDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastReconciliationSweepAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WorkerJobProcessor,
    @Optional() private readonly monitor?: PilotExposureMonitor,
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
      await this.enqueueReconciliationSweep();
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
        await this.processor.process({
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
      }
    } finally {
      this.running = false;
    }
  }

  private async enqueueReconciliationSweep(): Promise<void> {
    const intervalMs = Number(
      process.env.RECONCILIATION_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000,
    );
    const now = Date.now();
    if (now - this.lastReconciliationSweepAt < intervalMs) return;
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
    if (!transactions) return;
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
  }
}
