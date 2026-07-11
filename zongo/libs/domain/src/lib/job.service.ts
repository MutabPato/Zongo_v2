import { PrismaService } from '@app/db';
import { PartnerPort } from '@app/partner';
import { AuditLogPort } from '@app/audit';
import { Prisma } from '@prisma/client';

type WorkerJobInput = {
  transactionReference: string;
  jobType: 'COLLECTION' | 'PAYOUT';
  payload: Prisma.InputJsonValue;
};

export class WorkerJobProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partner: PartnerPort,
    private readonly audit: AuditLogPort,
  ) {}

  async process(job: WorkerJobInput): Promise<{ skipped: boolean }> {
    const dedupKey = `${job.transactionReference}:${job.jobType}`;

    const claimed = await this.prisma.workerJob
      .create({
        data: {
          dedupKey,
          jobType: job.jobType,
          transactionReference: job.transactionReference,
          payload: job.payload,
        },
      })
      .then(() => true)
      .catch((error) => {
        if (this.isUniqueViolation(error)) return false;
        throw error;
      });

    if (!claimed) return { skipped: true };

    await this.audit.append({
      id: crypto.randomUUID(),
      type: 'TECHNICAL',
      name: 'worker.job.claimed',
      payload: { dedupKey },
      createdAt: new Date(),
    });

    return { skipped: false };
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && error.message.includes('unique');
  }
}
