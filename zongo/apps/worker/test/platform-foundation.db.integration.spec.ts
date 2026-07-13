/* eslint-disable @typescript-eslint/unbound-method */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditService } from '@app/audit';
import { PartnerPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { WorkerJobProcessor } from '../src/worker-job.processor';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const value = envFile.match(
    /^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m,
  );
  if (value) process.env.DATABASE_URL = value[1] ?? value[2] ?? value[3];
}

loadDatabaseUrl();

const describeDatabase =
  process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('platform foundation (PostgreSQL)', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const corridorId = `corr-${suffix}`;
  const beneficiaryId = `ben-${suffix}`;
  const reference = `ZNG-DB-${suffix}`.toUpperCase();

  beforeAll(async () => {
    prisma = new PrismaService();
    audit = new AuditService(prisma);
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      // Audit history is intentionally immutable. Deleting its transaction would
      // cascade an UPDATE that clears AuditEvent.transactionId, which the database
      // trigger must reject. The test uses unique fixture IDs and retains that
      // evidence, while the mutable worker row can be cleaned up safely.
      await prisma.workerJob.deleteMany({
        where: { transactionReference: reference },
      });
    } finally {
      await prisma.onModuleDestroy();
    }
  });

  it('leases duplicate delivery once, records its visible effect, and blocks audit mutations', async () => {
    await prisma.corridor.create({
      data: { id: corridorId, code: `DB-${suffix}`, name: 'Database corridor' },
    });
    await prisma.beneficiary.create({
      data: {
        id: beneficiaryId,
        corridorId,
        userId: 'sender',
        displayName: 'Beneficiary',
        payoutCountryCode: 'KE',
        payoutCurrency: 'KES',
        phoneNumber: '+254700000000',
      },
    });
    const transaction = await prisma.transferTransaction.create({
      data: {
        reference,
        corridorId,
        senderUserId: 'sender',
        beneficiaryId,
        sendAmountMinor: 100n,
        sendCurrency: 'USD',
        idempotencyKey: `idem-${suffix}`,
      },
    });
    const partner: PartnerPort = {
      collect: jest
        .fn()
        .mockResolvedValue({ success: true, partnerReference: 'pt-db-1' }),
      payout: jest.fn(),
      getTransferStatus: jest.fn(),
    };
    const processor = new WorkerJobProcessor(prisma, partner, audit);

    await expect(
      processor.process({
        transactionReference: reference,
        jobType: 'COLLECTION',
        payload: {},
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    await expect(
      processor.process({
        transactionReference: reference,
        jobType: 'COLLECTION',
        payload: {},
      }),
    ).resolves.toEqual({ skipped: true, reason: 'already-claimed' });
    expect(partner.collect).toHaveBeenCalledTimes(1);
    await expect(
      prisma.transferTransaction.findUniqueOrThrow({
        where: { id: transaction.id },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'COLLECTION_SUCCESS' }),
    );

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { transactionId: transaction.id },
    });
    await expect(
      prisma.$executeRaw`UPDATE "AuditEvent" SET "name" = 'tampered' WHERE "id" = ${auditEvent.id}`,
    ).rejects.toThrow('append-only');
  });
});
