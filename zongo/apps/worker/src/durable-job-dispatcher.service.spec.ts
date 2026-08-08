/* eslint-disable @typescript-eslint/unbound-method */
import { JobStatus, JobType } from '@prisma/client';
import type { PrismaService } from '@app/db';
import { DurableJobDispatcher } from './durable-job-dispatcher.service';
import type { WorkerJobProcessor } from './worker-job.processor';

describe('DurableJobDispatcher', () => {
  it('never automatically dispatches a failed payout job', async () => {
    const prisma = {
      workerJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payout_job_1',
            transactionReference: 'ZNG-TEST-001',
            jobType: JobType.PAYOUT,
            status: JobStatus.FAILED,
            payload: {},
          },
        ]),
      },
    } as unknown as PrismaService;
    const processor = {
      process: jest.fn().mockResolvedValue({
        skipped: false,
        status: JobStatus.SUCCEEDED,
      }),
    } as unknown as WorkerJobProcessor;

    await new DurableJobDispatcher(prisma, processor).dispatch();

    expect(processor.process).not.toHaveBeenCalled();
  });
});
