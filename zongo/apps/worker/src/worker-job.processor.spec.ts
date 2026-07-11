/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { JobStatus } from '@prisma/client';
import type { AuditLogPort, PartnerPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { WorkerJobProcessor } from './worker-job.processor';

describe('WorkerJobProcessor', () => {
  const job = {
    transactionReference: 'ZNG-TEST-001',
    jobType: 'COLLECTION' as const,
    payload: {},
  };
  const transaction = {
    id: 'tx_1',
    reference: job.transactionReference,
    beneficiaryId: 'ben_1',
    sendAmountMinor: 100n,
    sendCurrency: 'USD',
    corridorId: 'corr_1',
  };

  it('does not execute a job that another worker holds', async () => {
    const partner = {
      collect: jest.fn(),
      payout: jest.fn(),
    } as unknown as PartnerPort;
    const audit = { append: jest.fn() } as unknown as AuditLogPort;
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    await expect(
      new WorkerJobProcessor(prisma, partner, audit).process(job),
    ).resolves.toEqual({ skipped: true, reason: 'already-claimed' });
    expect(partner.collect).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('records failure and permits a later retry to succeed', async () => {
    const partner: PartnerPort = {
      collect: jest
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: {
            message: 'temporary outage',
            code: 'PARTNER_TEMPORARY_FAILURE',
            retryable: true,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          partnerReference: 'partner_1',
        }),
      payout: jest.fn(),
    };
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      workerJob: {
        upsert: jest.fn().mockResolvedValue({ id: 'job_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
        update: jest.fn().mockReturnValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const processor = new WorkerJobProcessor(prisma, partner, audit);

    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'FAILED',
    });
    await expect(processor.process(job)).resolves.toEqual({
      skipped: false,
      status: 'SUCCEEDED',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          lastError: 'temporary outage',
        }),
      }),
    );
    expect(partner.collect).toHaveBeenCalledTimes(2);
    expect(partner.collect).toHaveBeenLastCalledWith({
      reference: job.transactionReference,
      amountMinor: 100n,
      currency: 'USD',
      beneficiaryId: 'ben_1',
    });
  });
});
