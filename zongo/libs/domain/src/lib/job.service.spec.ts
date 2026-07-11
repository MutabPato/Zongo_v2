import { AuditLogPort } from '@app/audit';
import { PrismaService } from '@app/db';
import { PartnerPort } from '@app/partner';
import { WorkerJobProcessor } from './job.service';

describe('WorkerJobProcessor', () => {
  it('claims a job and appends audit once on first delivery', async () => {
    const workerJobCreate = jest.fn().mockResolvedValue({ id: 'job_1' });
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      workerJob: { create: workerJobCreate },
    } as unknown as PrismaService;

    const partner = {} as PartnerPort;
    const audit = {
      append: auditAppend,
    } as unknown as AuditLogPort;

    const processor = new WorkerJobProcessor(prisma, partner, audit);

    const result = await processor.process({
      transactionReference: 'ZNG-TEST-123',
      jobType: 'COLLECTION',
      payload: { amount: 100 },
    });

    expect(result).toEqual({ skipped: false });
    expect(workerJobCreate).toHaveBeenCalledWith({
      data: {
        dedupKey: 'ZNG-TEST-123:COLLECTION',
        jobType: 'COLLECTION',
        transactionReference: 'ZNG-TEST-123',
        payload: { amount: 100 },
      },
    });
    expect(auditAppend).toHaveBeenCalledTimes(1);
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TECHNICAL',
        name: 'worker.job.claimed',
        payload: { dedupKey: 'ZNG-TEST-123:COLLECTION' },
      }),
    );
  });

  it('skips duplicate deliveries', async () => {
    const workerJobCreate = jest
      .fn()
      .mockRejectedValue(new Error('unique constraint failed'));
    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      workerJob: { create: workerJobCreate },
    } as unknown as PrismaService;

    const partner = {} as PartnerPort;
    const audit = {
      append: auditAppend,
    } as unknown as AuditLogPort;

    const processor = new WorkerJobProcessor(prisma, partner, audit);

    const result = await processor.process({
      transactionReference: 'ZNG-TEST-123',
      jobType: 'COLLECTION',
      payload: { amount: 100 },
    });

    expect(result).toEqual({ skipped: true });
    expect(auditAppend).not.toHaveBeenCalled();
  });
});
