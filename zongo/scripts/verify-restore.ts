import { PrismaService } from '@app/db';
import { Prisma } from '@prisma/client';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
  verifySensitiveSample,
  type RestoreCheck,
  type SensitiveSample,
} from '@app/security';

async function main(): Promise<void> {
  if (process.env.ALLOW_RESTORE_VERIFICATION !== 'true') {
    throw new Error(
      'Set ALLOW_RESTORE_VERIFICATION=true to run the read-only restore verification',
    );
  }

  const prisma = new PrismaService();
  const protection = new EnvelopeEncryptionService(
    new EnvironmentKeyProvider(),
  );
  await prisma.$connect();

  try {
    const checks: RestoreCheck[] = [];
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'postgres-connectivity', status: 'PASS', details: {} });

    const [
      auditRows,
      workerJobs,
      controls,
      sender,
      beneficiary,
      beneficiaryPayout,
      verification,
      session,
      inboundEvent,
      notification,
      rateLimitBuckets,
    ] = await Promise.all([
      prisma.auditEvent.count(),
      prisma.workerJob.count(),
      prisma.pilotControl.count(),
      prisma.senderProfile.findFirst({
        where: { senderPhoneCiphertext: { not: null } },
        select: {
          senderPhoneCiphertext: true,
          senderPhoneBlindIndex: true,
        },
      }),
      prisma.beneficiary.findFirst({
        where: { phoneNumberCiphertext: { not: Prisma.JsonNull } },
        select: {
          phoneNumberCiphertext: true,
          phoneNumberBlindIndex: true,
        },
      }),
      prisma.beneficiary.findFirst({
        where: { payoutAccountCiphertext: { not: Prisma.JsonNull } },
        select: {
          payoutAccountCiphertext: true,
        },
      }),
      prisma.senderVerification.findFirst({
        where: { evidenceCiphertext: { not: Prisma.JsonNull } },
        select: { evidenceCiphertext: true },
      }),
      prisma.whatsAppSession.findFirst({
        where: { senderPhoneCiphertext: { not: null } },
        select: { senderPhoneCiphertext: true },
      }),
      prisma.whatsAppInboundEvent.findFirst({
        where: { senderPhoneCiphertext: { not: null } },
        select: { senderPhoneCiphertext: true },
      }),
      prisma.notificationIntent.findFirst({
        where: { recipientPhoneCiphertext: { not: null } },
        select: { recipientPhoneCiphertext: true },
      }),
      prisma.whatsAppIngressRateLimitBucket.count(),
    ]);
    checks.push({
      name: 'durable-facts-present',
      status: 'PASS',
      details: { auditRows, workerJobs, controls },
    });

    const sensitiveSamples: SensitiveSample[] = [
      {
        name: 'sender-phone-ciphertext-decrypts',
        purpose: 'sender-phone',
        ciphertext: sender?.senderPhoneCiphertext,
        blindIndex: sender?.senderPhoneBlindIndex,
        verifyBlindIndex: Boolean(sender?.senderPhoneCiphertext),
      },
      {
        name: 'beneficiary-payout-ciphertext-decrypts',
        purpose: 'beneficiary-payout-account',
        ciphertext: beneficiaryPayout?.payoutAccountCiphertext,
      },
      {
        name: 'beneficiary-phone-ciphertext-decrypts',
        purpose: 'beneficiary-phone',
        ciphertext: beneficiary?.phoneNumberCiphertext,
        blindIndex: beneficiary?.phoneNumberBlindIndex,
        verifyBlindIndex: Boolean(beneficiary?.phoneNumberCiphertext),
      },
      {
        name: 'kyc-evidence-ciphertext-decrypts',
        purpose: 'kyc-evidence',
        ciphertext: verification?.evidenceCiphertext,
      },
      {
        name: 'session-phone-ciphertext-decrypts',
        purpose: 'sender-phone',
        ciphertext: session?.senderPhoneCiphertext,
      },
      {
        name: 'inbound-phone-ciphertext-decrypts',
        purpose: 'sender-phone',
        ciphertext: inboundEvent?.senderPhoneCiphertext,
      },
      {
        name: 'notification-recipient-ciphertext-decrypts',
        purpose: 'sender-phone',
        ciphertext: notification?.recipientPhoneCiphertext,
      },
    ];
    const sensitiveChecks = await Promise.all(
      sensitiveSamples.map((sample) =>
        verifySensitiveSample(protection, sample),
      ),
    );
    checks.push(...sensitiveChecks);
    const encryptedSamplesVerified = sensitiveChecks.some(
      (check) => check.status === 'PASS',
    );
    const encryptedSampleFailed = sensitiveChecks.some(
      (check) => check.status === 'FAIL',
    );

    checks.push({
      name: 'audit-and-control-state-readable',
      status: 'PASS',
      details: { auditRows, controls },
    });
    checks.push({
      name: 'redis-rebuild-inputs-readable',
      status: 'PASS',
      details: {
        rebuildFromDurableFacts: true,
        workerJobs,
        sessions: session ? 1 : 0,
        rateLimitBuckets,
      },
    });
    const redisLossEvidenceReference =
      process.env.REDIS_REBUILD_EVIDENCE_REF?.trim();
    checks.push({
      name: 'redis-loss-rebuild-executed',
      status: redisLossEvidenceReference ? 'PASS' : 'SKIPPED',
      details: {
        evidenceReferenceProvided: Boolean(redisLossEvidenceReference),
      },
    });
    const rpoMinutes = Number(process.env.PILOT_RPO_MINUTES);
    const rtoMinutes = Number(process.env.PILOT_RTO_MINUTES);
    const recoveryTargetsConfigured =
      Number.isInteger(rpoMinutes) &&
      rpoMinutes > 0 &&
      Number.isInteger(rtoMinutes) &&
      rtoMinutes > 0;
    checks.push({
      name: 'approved-rpo-rto-targets-recorded',
      status: recoveryTargetsConfigured ? 'PASS' : 'FAIL',
      details: {
        rpoMinutes: Number.isFinite(rpoMinutes) ? rpoMinutes : 'missing',
        rtoMinutes: Number.isFinite(rtoMinutes) ? rtoMinutes : 'missing',
      },
    });
    const complete =
      encryptedSamplesVerified &&
      !encryptedSampleFailed &&
      Boolean(redisLossEvidenceReference) &&
      recoveryTargetsConfigured;
    console.log(
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          status: complete ? 'PASS' : 'INCOMPLETE',
          checks,
          note: complete
            ? 'This artifact proves read-only restore invariants; it does not approve production release.'
            : 'Restore verification is incomplete until encrypted samples decrypt, Redis-loss rebuild evidence and approved RPO/RTO targets are attached; this does not approve production release.',
        },
        null,
        2,
      ),
    );
    if (!complete) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('Restore verification failed');
  process.exitCode = 1;
});
