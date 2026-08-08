import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditService } from '@app/audit';
import { PrismaService } from '@app/db';
import { TransactionReferenceService, type PartnerPort } from '@app/domain';
import { LedgerService } from '@app/ledger';
import { Prisma } from '@prisma/client';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
} from '@app/security';
import {
  WhatsAppSessionService,
  WhatsAppWebhookSignatureService,
} from '@app/whatsapp';
import { WhatsAppWebhookController } from '../../api/src/whatsapp-webhook.controller';
import { TransferInitiationService } from '../../../libs/transfer/src/transfer-initiation.service';
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

describeDatabase('local DRC-to-Kenya customer journey (PostgreSQL)', () => {
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const phone = `+243800${suffix.replace(/\D/g, '').slice(-6)}`;
  const chatId = `chat-${suffix}`;
  const corridorId = `corridor-${suffix}`;
  const beneficiaryId = `beneficiary-${suffix}`;
  const profileId = `profile-${suffix}`;
  const userId = `user-${suffix}`;
  const referencePrefix = 'ZNG-';
  let prisma: PrismaService;
  let keyEnvironment: NodeJS.ProcessEnv;

  beforeAll(async () => {
    process.env.META_APP_SECRET = 'local-meta-secret';
    for (const purpose of [
      'SENDER_PHONE',
      'BENEFICIARY_PAYOUT_ACCOUNT',
      'PROVIDER_REFERENCE',
    ]) {
      process.env[`ZONGO_ENCRYPTION_KEY_${purpose}_V1`] =
        randomBytes(32).toString('base64url');
      process.env[`ZONGO_ENCRYPTION_KEY_VERSION_${purpose}`] = 'V1';
      process.env[`ZONGO_BLIND_INDEX_KEY_${purpose}`] =
        randomBytes(32).toString('base64url');
    }
    keyEnvironment = { ...process.env };
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('traverses signed intake through reconciled payout and notification', async () => {
    const protection = new EnvelopeEncryptionService(
      new EnvironmentKeyProvider(keyEnvironment),
    );
    const audit = new AuditService(prisma);
    const ledger = new LedgerService(prisma, audit, {
      warning: jest.fn().mockResolvedValue(undefined),
      urgent: jest.fn().mockResolvedValue(undefined),
    });
    const phoneCiphertext = JSON.stringify(
      await protection.encrypt(phone, 'sender-phone'),
    );
    const phoneBlindIndex = await protection.blindIndex(phone, 'sender-phone');
    const payoutAccountCiphertext = JSON.stringify(
      await protection.encrypt(
        JSON.stringify({ network: 'M-PESA', account: phone }),
        'beneficiary-payout-account',
      ),
    );

    await prisma.pilotControl.createMany({
      data: [
        { key: 'GLOBAL', state: 'ENABLED' },
        { key: 'INITIATION', state: 'ENABLED' },
        { key: 'COLLECTION', state: 'ENABLED' },
        { key: 'PAYOUT', state: 'ENABLED' },
        { key: 'NOTIFICATION', state: 'ENABLED' },
        { key: 'CORRIDOR_PROVIDER', state: 'ENABLED' },
      ],
      skipDuplicates: true,
    });
    await prisma.platformIdentity.create({ data: { userId } });
    await prisma.corridor.create({
      data: { id: corridorId, code: `DRC-KE-${suffix}`, name: 'DRC to Kenya' },
    });
    await prisma.corridorPolicy.create({
      data: {
        corridorId,
        version: 1,
        sendCurrency: 'CDF',
        payoutCurrency: 'KES',
        minSendAmountMinor: 1n,
        maxSendAmountMinor: 1_000_000n,
        rules: {},
      },
    });
    await prisma.senderProfile.create({
      data: {
        id: profileId,
        userId,
        legalName: 'Local E2E Sender',
        senderPhoneNumber: phone,
        senderPhoneCiphertext: phoneCiphertext,
        senderPhoneBlindIndex: phoneBlindIndex,
        whatsappPhoneNumber: phone,
        tier: 'TIER_1',
        verifiedAt: new Date(),
        pilotAllowlist: { create: { enabled: true, reason: 'local-e2e' } },
      },
    });
    await prisma.pilotExposurePolicy.upsert({
      where: { id: 'pilot' },
      create: { id: 'pilot', allowlistRequired: true },
      update: { allowlistRequired: true },
    });
    await prisma.beneficiary.create({
      data: {
        id: beneficiaryId,
        corridorId,
        userId,
        displayName: 'Kenya Beneficiary',
        payoutCountryCode: 'KE',
        payoutCurrency: 'KES',
        phoneNumber: '+254700000000',
        payoutAccountCiphertext,
      },
    });

    const sessions = new WhatsAppSessionService(prisma, audit, protection);
    const controller = new WhatsAppWebhookController(
      new WhatsAppWebhookSignatureService(),
      sessions,
    );
    const receive = async (id: string, text: string) => {
      const rawBody = JSON.stringify({
        id,
        from: phone,
        chat_id: chatId,
        text,
      });
      const signature = `sha256=${createHmac(
        'sha256',
        process.env.META_APP_SECRET!,
      )
        .update(rawBody)
        .digest('hex')}`;
      return controller.receive({ rawBody }, signature, {
        id,
        from: phone,
        chat_id: chatId,
        text,
        type: 'text',
        message_id: id,
      });
    };

    await expect(receive(`start-${suffix}`, 'tuma pesa')).resolves.toEqual(
      expect.objectContaining({ received: true, accepted: true }),
    );
    await expect(receive(`consent-${suffix}`, 'ndiyo')).resolves.toEqual(
      expect.objectContaining({ received: true, reason: 'CONSENT_CAPTURED' }),
    );
    const inboundEvent = await prisma.whatsAppInboundEvent.findUniqueOrThrow({
      where: { externalEventId: `consent-${suffix}` },
    });

    const initiation = new TransferInitiationService(
      prisma,
      new TransactionReferenceService(),
      audit,
      protection,
    );
    const first = await initiation.initiate({
      senderProfileId: profileId,
      senderPhoneNumber: phone,
      chatId,
      inboundEventId: inboundEvent.id,
      corridorId,
      beneficiaryId,
      sendAmountMinor: 100_000n,
      sendCurrency: 'CDF',
      payoutAmountMinor: 1_000n,
      payoutCurrency: 'KES',
      quoteId: `quote-${suffix}`,
      quoteSnapshot: { rate: '0.01', captured: true },
      idempotencyKey: `idem-${suffix}`,
    });
    const duplicate = await initiation.initiate({
      senderProfileId: profileId,
      senderPhoneNumber: phone,
      chatId,
      inboundEventId: inboundEvent.id,
      corridorId,
      beneficiaryId,
      sendAmountMinor: 100_000n,
      sendCurrency: 'CDF',
      payoutAmountMinor: 1_000n,
      payoutCurrency: 'KES',
      quoteId: `quote-${suffix}`,
      quoteSnapshot: { rate: '0.01', captured: true },
      idempotencyKey: `idem-${suffix}`,
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);

    const partner: PartnerPort = {
      collect: jest.fn().mockResolvedValue({
        success: true,
        partnerReference: `pretium-collect-${suffix}`,
      }),
      payout: jest.fn().mockResolvedValue({
        success: true,
        partnerReference: `pretium-payout-${suffix}`,
      }),
      status: jest.fn(),
    };
    const notifications = { send: jest.fn().mockResolvedValue(undefined) };
    const worker = new WorkerJobProcessor(
      prisma,
      partner,
      audit,
      ledger,
      notifications,
      protection,
    );
    const transaction = await prisma.transferTransaction.findUniqueOrThrow({
      where: { id: first.accepted.id },
    });
    await expect(
      worker.process({
        transactionReference: transaction.reference,
        jobType: 'COLLECTION',
        payload: {},
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    const payoutJob = await prisma.workerJob.findUniqueOrThrow({
      where: { dedupKey: `${transaction.reference}:PAYOUT` },
    });
    await expect(
      worker.process({
        transactionReference: transaction.reference,
        jobType: 'PAYOUT',
        payload: {},
        persistedJobId: payoutJob.id,
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });
    const notificationJob = await prisma.workerJob.findFirstOrThrow({
      where: { transactionId: transaction.id, jobType: 'NOTIFICATION' },
    });
    await expect(
      worker.process({
        transactionReference: transaction.reference,
        jobType: 'NOTIFICATION',
        payload: notificationJob.payload as Prisma.InputJsonValue,
        persistedJobId: notificationJob.id,
      }),
    ).resolves.toEqual({ skipped: false, status: 'SUCCEEDED' });

    const completed = await prisma.transferTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { ledgerEntries: true, reconciliation: true },
    });
    expect(completed.status).toBe('PAYOUT_SUCCESS');
    expect(completed.ledgerEntries.map((entry) => entry.eventName)).toEqual(
      expect.arrayContaining(['collection', 'payout']),
    );
    expect(completed.reconciliation?.status).toBe('CONSISTENT');
    expect(notifications.send).toHaveBeenCalled();
    expect(
      await prisma.whatsAppSession.findUnique({
        where: {
          id: (
            await prisma.whatsAppSession.findFirstOrThrow({ where: { chatId } })
          ).id,
        },
      }),
    ).toEqual(expect.objectContaining({ status: 'CLOSED' }));
    expect(
      await prisma.auditEvent.count({
        where: { transactionId: transaction.id },
      }),
    ).toBeGreaterThanOrEqual(3);
    expect(transaction.reference.startsWith(referencePrefix)).toBe(true);
  });
});
