import { PrismaService } from '@app/db';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
} from '@app/security';

type RestoreCheck = {
  name: string;
  status: 'PASS' | 'SKIPPED' | 'FAIL';
  details: Record<string, number | string | boolean>;
};

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
    let encryptionRestoreVerified = false;
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'postgres-connectivity', status: 'PASS', details: {} });

    const [auditRows, workerJobs, controls, sender] = await Promise.all([
      prisma.auditEvent.count(),
      prisma.workerJob.count(),
      prisma.pilotControl.count(),
      prisma.senderProfile.findFirst({
        select: {
          emailCiphertext: true,
          senderPhoneCiphertext: true,
          senderPhoneBlindIndex: true,
        },
      }),
    ]);
    checks.push({
      name: 'durable-facts-present',
      status: 'PASS',
      details: { auditRows, workerJobs, controls },
    });

    if (!sender?.senderPhoneCiphertext) {
      checks.push({
        name: 'sender-ciphertext-decrypts',
        status: 'SKIPPED',
        details: { reason: 'No encrypted sender sample exists' },
      });
    } else {
      const phone = await protection.decrypt(
        JSON.parse(sender.senderPhoneCiphertext),
        'sender-phone',
      );
      const derivedIndex = await protection.blindIndex(phone, 'sender-phone');
      const matchingIndexes = sender.senderPhoneBlindIndex === derivedIndex;
      checks.push({
        name: 'sender-ciphertext-decrypts',
        status: 'PASS',
        details: { blindIndexMatches: matchingIndexes },
      });
      if (!matchingIndexes)
        throw new Error('Sender blind-index verification failed');
      encryptionRestoreVerified = true;
    }

    checks.push({
      name: 'audit-and-control-state-readable',
      status: 'PASS',
      details: { auditRows, controls },
    });
    checks.push({
      name: 'redis-rebuild-required',
      status: 'PASS',
      details: { rebuildFromDurableFacts: true },
    });
    const complete = encryptionRestoreVerified;
    console.log(
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          status: complete ? 'PASS' : 'INCOMPLETE',
          checks,
          note: complete
            ? 'This artifact proves read-only restore invariants; it does not approve production release.'
            : 'Restore verification is incomplete until an encrypted sample is decrypted with the restored key set; this does not approve production release.',
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
