import { buildSenderProfileBackfillData } from '../../../scripts/backfill-sensitive-blind-indexes';
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
});
