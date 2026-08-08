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

  it('redispatches a durable failed status check after a worker restart', async () => {
    const prisma = {
      workerJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'status_job_1',
            transactionReference: 'ZNG-TEST-001',
            jobType: JobType.STATUS_RECHECK,
            status: JobStatus.FAILED,
            payload: { reason: 'SESSION_TIMEOUT' },
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

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        persistedJobId: 'status_job_1',
        jobType: JobType.STATUS_RECHECK,
      }),
    );
  });

  it('queues reconciliation jobs on the configured cadence', async () => {
    process.env.RECONCILIATION_SWEEP_INTERVAL_MS = '1';
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      transferTransaction: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'tx_1', reference: 'ZNG-1' }]),
      },
      workerJob: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert,
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const processor = {
      process: jest.fn(),
    } as unknown as WorkerJobProcessor;

    await new DurableJobDispatcher(prisma, processor).dispatch();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        create: expect.objectContaining({
          jobType: JobType.RECONCILIATION,
          transactionReference: 'ZNG-1',
        }),
      }),
    );
    delete process.env.RECONCILIATION_SWEEP_INTERVAL_MS;
  });

  it('queues provider status checks for pending collection and payout work', async () => {
    process.env.STATUS_RECHECK_SWEEP_INTERVAL_MS = '1';
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      transferTransaction: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'tx_pending', reference: 'ZNG-PENDING' }]),
      },
      workerJob: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert,
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const processor = { process: jest.fn() } as unknown as WorkerJobProcessor;

    await new DurableJobDispatcher(prisma, processor).dispatch();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          jobType: JobType.STATUS_RECHECK,
          transactionReference: 'ZNG-PENDING',
          payload: expect.objectContaining({
            reason: 'PENDING_PROVIDER_SWEEP',
          }),
        }),
      }),
    );
    delete process.env.STATUS_RECHECK_SWEEP_INTERVAL_MS;
  });
});
