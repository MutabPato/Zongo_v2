import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '@app/db';
import { WorkerJobProcessor } from './worker-job.processor';

/** Polls the database-backed queue; claims in WorkerJobProcessor prevent races. */
@Injectable()
export class DurableJobDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WorkerJobProcessor,
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
      const jobs = await this.prisma.workerJob.findMany({
        where: {
          jobType: {
            in: [JobType.COLLECTION, JobType.PAYOUT, JobType.STATUS_RECHECK],
          },
          status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const job of jobs) {
        await this.processor.process({
          persistedJobId: job.id,
          transactionReference: job.transactionReference,
          jobType: job.jobType as Extract<
            JobType,
            'COLLECTION' | 'PAYOUT' | 'STATUS_RECHECK'
          >,
          payload: job.payload as Prisma.InputJsonValue,
        });
      }
    } finally {
      this.running = false;
    }
  }
}
