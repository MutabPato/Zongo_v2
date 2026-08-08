/* eslint-disable @typescript-eslint/unbound-method */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditService } from '@app/audit';
import { PartnerPort } from '@app/domain';
import { PrismaService } from '@app/db';
import { LedgerService } from '@app/ledger';
import { WorkerJobProcessor } from '../src/worker-job.processor';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const envFile = readFileSync(envPath, 'utf8');
  const value = envFile.match(
    /^DATABASE_URL=(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m,
  );
  if (value) process.env.DATABASE_URL = value[1] ?? value[2] ?? value[3];
}

const databaseIntegrationRequested =
  process.env.RUN_DATABASE_INTEGRATION === 'true';
if (databaseIntegrationRequested) loadDatabaseUrl();
const databaseIntegrationEnabled =
  databaseIntegrationRequested &&
  Boolean(
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_HOST &&
      process.env.POSTGRES_USER &&
      process.env.POSTGRES_PASSWORD &&
      process.env.POSTGRES_DB),
  );

const describeDatabase = databaseIntegrationEnabled ? describe : describe.skip;

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
    await prisma.pilotControl.createMany({
      data: [
        { key: 'GLOBAL', state: 'ENABLED' },
        { key: 'CORRIDOR_PROVIDER', state: 'ENABLED' },
        { key: 'COLLECTION', state: 'ENABLED' },
        { key: 'PAYOUT', state: 'ENABLED' },
      ],
      skipDuplicates: true,
    });
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
        payoutAmountMinor: 12_900n,
        payoutCurrency: 'KES',
        idempotencyKey: `idem-${suffix}`,
      },
    });
    const partner: PartnerPort = {
      collect: jest
        .fn()
        .mockResolvedValue({ success: true, partnerReference: 'pt-db-1' }),
      payout: jest
        .fn()
        .mockResolvedValue({ success: true, partnerReference: 'pt-db-2' }),
      status: jest.fn(),
    };
    const ledger = new LedgerService(prisma, audit, {
      warning: jest.fn().mockResolvedValue(undefined),
      urgent: jest.fn().mockResolvedValue(undefined),
    });
    const processor = new WorkerJobProcessor(prisma, partner, audit, ledger);

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
    const payoutJob = await prisma.workerJob.findUniqueOrThrow({
      where: { dedupKey: `${reference}:PAYOUT` },
    });
    expect(payoutJob).toEqual(
      expect.objectContaining({
        jobType: 'PAYOUT',
        transactionReference: reference,
      }),
    );
    await expect(
      processor.process({
        transactionReference: reference,
        jobType: 'PAYOUT',
        payload: { reason: 'COLLECTION_SUCCESS' },
        persistedJobId: payoutJob.id,
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    expect(partner.payout).toHaveBeenCalledTimes(1);
    await expect(
      prisma.transferTransaction.findUniqueOrThrow({
        where: { id: transaction.id },
        include: { ledgerEntries: true, reconciliation: true },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'PAYOUT_SUCCESS',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        ledgerEntries: expect.arrayContaining([
          expect.objectContaining({ eventName: 'collection' }),
          expect.objectContaining({ eventName: 'payout' }),
        ]),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        reconciliation: expect.objectContaining({ status: 'CONSISTENT' }),
      }),
    );

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { transactionId: transaction.id },
    });
    await expect(
      prisma.$executeRaw`UPDATE "AuditEvent" SET "name" = 'tampered' WHERE "id" = ${auditEvent.id}`,
    ).rejects.toThrow('append-only');
  });
});
