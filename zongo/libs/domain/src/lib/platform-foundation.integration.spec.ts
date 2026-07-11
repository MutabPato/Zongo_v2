import { type AuditLogPort } from '@app/audit';
import { PrismaService } from '@app/db';
import { PretiumPartnerAdapter } from '@app/partner/lib/pretium-adapter.service';
import type { PretiumClient } from '@app/partner/lib/pretium-adapter';
import type { Corridor } from './corridor';
import type { CorridorPolicy } from './corridor-policy';
import { TransactionReferenceService } from './transaction-reference.service';
import { WorkerJobProcessor } from './job.service';

describe('platform foundation integration', () => {
  it('covers corridor modeling, adapter normalization, worker idempotency, reference generation, and audit append', async () => {
    const corridor: Corridor = {
      id: 'corr_1',
      code: 'DRC-KE',
      displayName: 'DRC to Kenya',
      active: true,
    };

    const policy: CorridorPolicy = {
      corridorCode: corridor.code,
      maxAmount: 5000,
      supportsCollection: true,
      supportsPayout: true,
      requiresManualReview: false,
    };

    expect(policy.corridorCode).toBe(corridor.code);

    const referenceService = new TransactionReferenceService();
    const reference = referenceService.generate();

    expect(reference).toMatch(/^ZNG-/);

    const collect = jest.fn().mockResolvedValue({ partnerReference: 'pt_123' });
    const payout = jest.fn().mockResolvedValue({ partnerReference: 'pt_456' });

    const partnerClient = {
      collect,
      payout,
    } as unknown as PretiumClient;

    const partner = new PretiumPartnerAdapter(partnerClient);

    await expect(
      partner.collect({
        reference,
        amount: 100,
        currency: 'USD',
        beneficiaryId: 'ben_1',
      }),
    ).resolves.toEqual({
      success: true,
      partnerReference: 'pt_123',
    });

    const workerJobCreate = jest
      .fn()
      .mockResolvedValueOnce({ id: 'job_1' })
      .mockRejectedValueOnce(new Error('unique constraint failed'));

    const auditAppend = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      workerJob: {
        create: workerJobCreate,
      },
    } as unknown as PrismaService;

    const audit = {
      append: auditAppend,
    } as unknown as AuditLogPort;
    const processor = new WorkerJobProcessor(prisma, partner, audit);

    await expect(
      processor.process({
        transactionReference: reference,
        jobType: 'COLLECTION',
        payload: { corridorId: corridor.id },
      }),
    ).resolves.toEqual({ skipped: false });

    await expect(
      processor.process({
        transactionReference: reference,
        jobType: 'COLLECTION',
        payload: { corridorId: corridor.id },
      }),
    ).resolves.toEqual({ skipped: true });

    expect(auditAppend).toHaveBeenCalledTimes(1);
  });
});
