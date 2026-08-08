import {
  buildBeneficiaryBackfillData,
  buildSenderProfileBackfillData,
  buildVerificationPhoneBackfillData,
} from '../../../scripts/backfill-sensitive-blind-indexes';
import type { EnvelopeEncryptionService } from './security.service';

describe('sensitive-data backfill mutations', () => {
  it('encrypts and explicitly clears legacy sender fields', async () => {
    const protection = {
      encrypt: jest.fn().mockResolvedValue({ ciphertext: 'encrypted' }),
      blindIndex: jest.fn().mockResolvedValue('blind-index'),
    };

    await expect(
      buildSenderProfileBackfillData(
        {
          email: 'sender@example.test',
          emailCiphertext: null,
          senderPhoneNumber: '+243800000001',
          senderPhoneCiphertext: null,
          whatsappPhoneNumber: '+243800000001',
          backupPhoneNumber: '+243800000002',
          backupPhoneCiphertext: null,
        },
        protection as unknown as EnvelopeEncryptionService,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        email: null,
        senderPhoneNumber: null,
        whatsappPhoneNumber: null,
        backupPhoneNumber: null,
        emailCiphertext: '{"ciphertext":"encrypted"}',
        senderPhoneCiphertext: '{"ciphertext":"encrypted"}',
        backupPhoneCiphertext: '{"ciphertext":"encrypted"}',
      }),
    );
  });

  it('encrypts and explicitly clears legacy verification phones', async () => {
    const protection = {
      encrypt: jest.fn().mockResolvedValue({ ciphertext: 'encrypted' }),
    };

    await expect(
      buildVerificationPhoneBackfillData(
        '+243800000001',
        protection as unknown as EnvelopeEncryptionService,
      ),
    ).resolves.toEqual({
      verifiedPhoneNumber: null,
      verifiedPhoneNumberCiphertext: '{"ciphertext":"encrypted"}',
    });
  });

  it('encrypts and indexes legacy beneficiary phone values', async () => {
    const protection = {
      encrypt: jest.fn().mockResolvedValue({ ciphertext: 'encrypted' }),
      blindIndex: jest.fn().mockResolvedValue('phone-blind-index'),
    };

    await expect(
      buildBeneficiaryBackfillData(
        {
          phoneNumber: '+254700000001',
          phoneNumberCiphertext: null,
          payoutAccount: null,
          payoutAccountCiphertext: null,
        },
        protection as unknown as EnvelopeEncryptionService,
      ),
    ).resolves.toEqual({
      phoneNumber: null,
      phoneNumberCiphertext: '{"ciphertext":"encrypted"}',
      phoneNumberBlindIndex: 'phone-blind-index',
    });
  });
});
