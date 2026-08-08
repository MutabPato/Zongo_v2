import { PrismaService } from '@app/db';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
} from '@app/security';
import { Prisma } from '@prisma/client';

const BATCH_SIZE = 100;

export type SensitiveSenderBackfillRow = {
  email: string | null;
  emailCiphertext: string | null;
  senderPhoneNumber: string | null;
  senderPhoneCiphertext: string | null;
  whatsappPhoneNumber: string | null;
  backupPhoneNumber: string | null;
  backupPhoneCiphertext: string | null;
};

export async function buildSenderProfileBackfillData(
  row: SensitiveSenderBackfillRow,
  protection: EnvelopeEncryptionService,
): Promise<Prisma.SenderProfileUpdateInput> {
  const senderPhone = row.senderPhoneNumber ?? row.whatsappPhoneNumber;
  return {
    ...(row.email && !row.emailCiphertext
      ? {
          emailCiphertext: JSON.stringify(
            await protection.encrypt(row.email, 'sender-email'),
          ),
          emailBlindIndex: await protection.blindIndex(
            row.email,
            'sender-email',
          ),
          email: null,
        }
      : {}),
    ...(senderPhone && !row.senderPhoneCiphertext
      ? {
          senderPhoneCiphertext: JSON.stringify(
            await protection.encrypt(senderPhone, 'sender-phone'),
          ),
          senderPhoneBlindIndex: await protection.blindIndex(
            senderPhone,
            'sender-phone',
          ),
          senderPhoneNumber: null,
          whatsappPhoneNumber: null,
        }
      : {}),
    ...(row.backupPhoneNumber && !row.backupPhoneCiphertext
      ? {
          backupPhoneCiphertext: JSON.stringify(
            await protection.encrypt(row.backupPhoneNumber, 'sender-phone'),
          ),
          backupPhoneNumber: null,
        }
      : {}),
  };
}

export async function buildVerificationPhoneBackfillData(
  phone: string,
  protection: EnvelopeEncryptionService,
): Promise<Prisma.SenderVerificationUpdateInput> {
  return {
    verifiedPhoneNumber: null,
    verifiedPhoneNumberCiphertext: JSON.stringify(
      await protection.encrypt(phone, 'sender-phone'),
    ),
  };
}

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
    let senderProfiles = 0;
    while (true) {
      const rows = await prisma.senderProfile.findMany({
        where: {
          OR: [
            { email: { not: null }, emailCiphertext: null },
            {
              senderPhoneCiphertext: null,
              OR: [
                { senderPhoneNumber: { not: null } },
                { whatsappPhoneNumber: { not: null } },
              ],
            },
            { backupPhoneNumber: { not: null }, backupPhoneCiphertext: null },
          ],
        },
        select: {
          id: true,
          email: true,
          emailCiphertext: true,
          senderPhoneNumber: true,
          senderPhoneCiphertext: true,
          whatsappPhoneNumber: true,
          backupPhoneNumber: true,
          backupPhoneCiphertext: true,
        },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await prisma.senderProfile.update({
          where: { id: row.id },
          data: await buildSenderProfileBackfillData(row, protection),
        });
        senderProfiles += 1;
      }
    }

    let beneficiaries = 0;
    while (true) {
      const rows = await prisma.beneficiary.findMany({
        where: {
          payoutAccount: { not: Prisma.JsonNull },
          payoutAccountCiphertext: { equals: Prisma.DbNull },
        },
        select: { id: true, payoutAccount: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!row.payoutAccount) continue;
        await prisma.beneficiary.update({
          where: { id: row.id },
          data: {
            payoutAccountCiphertext: JSON.stringify(
              await protection.encrypt(
                JSON.stringify(row.payoutAccount),
                'beneficiary-payout-account',
              ),
            ),
            payoutAccount: Prisma.JsonNull,
          },
        });
        beneficiaries += 1;
      }
    }

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

    let verificationPhones = 0;
    while (true) {
      const rows = await prisma.senderVerification.findMany({
        where: {
          verifiedPhoneNumber: { not: null },
          verifiedPhoneNumberCiphertext: { equals: Prisma.DbNull },
        },
        select: { id: true, verifiedPhoneNumber: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await prisma.senderVerification.update({
          where: { id: row.id },
          data: await buildVerificationPhoneBackfillData(
            row.verifiedPhoneNumber!,
            protection,
          ),
        });
        verificationPhones += 1;
      }
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
      `Sensitive backfill complete: ${senderProfiles} sender profiles, ${beneficiaries} beneficiaries, ${verificationPhones} verification phones, ${verifications} verification references, ${transactions} transaction rows`,
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

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Backfill failed');
    process.exitCode = 1;
  });
