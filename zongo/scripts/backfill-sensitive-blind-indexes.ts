import { PrismaService } from '@app/db';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
} from '@app/security';

const BATCH_SIZE = 100;

async function main(): Promise<void> {
  if (process.env.ALLOW_SENSITIVE_INDEX_BACKFILL !== 'true') {
    throw new Error(
      'Refusing to backfill sensitive indexes; set ALLOW_SENSITIVE_INDEX_BACKFILL=true explicitly',
    );
  }

  const prisma = new PrismaService();
  const protection = new EnvelopeEncryptionService(
    new EnvironmentKeyProvider(),
  );
  await prisma.$connect();

  try {
    let verifications = 0;
    while (true) {
      const rows = await prisma.senderVerification.findMany({
        where: {
          providerReference: { not: '' },
          providerReferenceBlindIndex: { equals: null },
        },
        select: { id: true, providerReference: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const indexedRows = await Promise.all(
        rows.map(async (row) => ({
          row,
          index: row.providerReference
            ? await awaitIndex(protection, row.providerReference)
            : null,
        })),
      );
      const updates = indexedRows.map(({ row, index }) =>
        prisma.senderVerification.update({
          where: { id: row.id },
          data: { providerReferenceBlindIndex: index },
        }),
      );
      await prisma.$transaction(updates);
      verifications += rows.length;
    }

    let transactions = 0;
    while (true) {
      const rows = await prisma.transferTransaction.findMany({
        where: {
          partnerReference: { not: null },
          partnerReferenceBlindIndex: { equals: null },
        },
        select: { id: true, partnerReference: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const indexedRows = await Promise.all(
        rows.map(async (row) => ({
          row,
          index: row.partnerReference
            ? await awaitIndex(protection, row.partnerReference)
            : null,
        })),
      );
      const updates = indexedRows.map(({ row, index }) =>
        prisma.transferTransaction.update({
          where: { id: row.id },
          data: { partnerReferenceBlindIndex: index },
        }),
      );
      await prisma.$transaction(updates);
      transactions += rows.length;
    }

    console.log(
      `Sensitive blind-index backfill complete: ${verifications} verification rows, ${transactions} transaction rows`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function awaitIndex(
  protection: EnvelopeEncryptionService,
  value: string,
): Promise<string> {
  return protection.blindIndex(value, 'provider-reference');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Backfill failed');
  process.exitCode = 1;
});
