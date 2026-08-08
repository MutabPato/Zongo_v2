/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CurrencyCode, TransactionStatus } from '@prisma/client';
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { BeneficiaryService } from './beneficiary.service';

describe('BeneficiaryService', () => {
  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogPort;
  const protection = {
    encrypt: jest.fn((value: string) => ({
      algorithm: 'aes-256-gcm' as const,
      keyVersion: 'v1',
      iv: 'iv',
      ciphertext: value,
      authTag: 'tag',
    })),
    blindIndex: jest.fn().mockResolvedValue('phone-blind-index'),
  } as any;
  const details = {
    userId: 'sender_1',
    corridorId: 'corr_1',
    displayName: 'Amina',
    payoutCountryCode: 'KE',
    payoutCurrency: CurrencyCode.KES,
    phoneNumber: '+254700000001',
    payoutAccount: { account: '123' },
  };

  it('creates reusable saved beneficiaries and selects only current records for the sender/corridor', async () => {
    const created = {
      id: 'ben_1',
      familyId: 'family_1',
      ...details,
      isCurrent: true,
    };
    const create = jest.fn().mockResolvedValue(created);
    const prisma = {
      beneficiary: {
        create,
        findUniqueOrThrow: jest.fn().mockResolvedValue(created),
      },
    } as unknown as PrismaService;
    const service = new BeneficiaryService(prisma, audit, protection);

    await expect(service.create(details)).resolves.toEqual(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumber: null,
          phoneNumberCiphertext: expect.any(String),
          phoneNumberBlindIndex: 'phone-blind-index',
        }),
      }),
    );
    await expect(
      service.selectForTransfer(created.id, details.userId, details.corridorId),
    ).resolves.toEqual(created);
  });

  it('creates a new version rather than changing the original payout target', async () => {
    const original = {
      id: 'ben_1',
      familyId: 'family_1',
      version: 1,
      isCurrent: true,
      ...details,
    };
    const revision = {
      id: 'ben_2',
      familyId: 'family_1',
      version: 2,
      isCurrent: true,
      ...details,
      phoneNumber: '+254700000002',
    };
    const create = jest.fn().mockResolvedValue(revision);
    const update = jest
      .fn()
      .mockResolvedValue({ ...original, isCurrent: false });
    const prisma = {
      beneficiary: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(original),
        create,
        update,
      },
    } as unknown as PrismaService;

    await expect(
      new BeneficiaryService(prisma, audit, protection).revise(original.id, {
        ...details,
        phoneNumber: revision.phoneNumber,
      }),
    ).resolves.toEqual(revision);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: original.familyId,
          version: 2,
          supersedesId: original.id,
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: original.id },
      data: { isCurrent: false },
    });
    expect(original.phoneNumber).toBe('+254700000001');
  });

  it('attaches a corrected retry target without replacing the failed transfer beneficiary', async () => {
    const transaction = {
      id: 'tx_1',
      senderUserId: details.userId,
      corridorId: details.corridorId,
      beneficiaryId: 'ben_original',
      status: TransactionStatus.PAYOUT_FAILED,
    };
    const corrected = { id: 'ben_corrected', isCurrent: true, ...details };
    const update = jest
      .fn()
      .mockResolvedValue({ ...transaction, retryBeneficiaryId: corrected.id });
    const prisma = {
      transferTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
        update,
      },
      beneficiary: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(corrected),
      },
    } as unknown as PrismaService;

    await expect(
      new BeneficiaryService(prisma, audit, protection).setRetryTarget(
        transaction.id,
        corrected.id,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ retryBeneficiaryId: corrected.id }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: transaction.id },
      data: { retryBeneficiaryId: corrected.id },
    });
    expect(transaction.beneficiaryId).toBe('ben_original');
  });
});
