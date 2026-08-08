import { randomBytes } from 'node:crypto';
import {
  EnvelopeEncryptionService,
  type EncryptionKeyProvider,
} from './security.service';
import { verifySensitiveSample } from './restore-sample-verifier';

function service(): EnvelopeEncryptionService {
  const key = randomBytes(32);
  const keys: EncryptionKeyProvider = {
    currentKey: jest.fn().mockResolvedValue({ version: 'V1', key }),
    keyForVersion: jest.fn().mockResolvedValue({ version: 'V1', key }),
    blindIndexKey: jest.fn().mockResolvedValue(randomBytes(32)),
  };
  return new EnvelopeEncryptionService(keys);
}

describe('verifySensitiveSample', () => {
  it('skips a domain with no encrypted sample', async () => {
    await expect(
      verifySensitiveSample(service(), {
        name: 'beneficiary-phone',
        purpose: 'beneficiary-phone',
        ciphertext: null,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'SKIPPED' }),
    );
  });

  it('fails when the beneficiary phone blind index does not match', async () => {
    const protection = service();
    const ciphertext = await protection.encrypt(
      '+243800000001',
      'beneficiary-phone',
    );

    await expect(
      verifySensitiveSample(protection, {
        name: 'beneficiary-phone',
        purpose: 'beneficiary-phone',
        ciphertext,
        blindIndex: 'wrong-index',
        verifyBlindIndex: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'FAIL',
        details: expect.objectContaining({
          decrypted: true,
          blindIndexMatches: false,
        }),
      }),
    );
  });

  it('fails closed when the beneficiary phone ciphertext cannot decrypt', async () => {
    const protection = service();
    const ciphertext = await protection.encrypt(
      '+243800000001',
      'beneficiary-phone',
    );
    ciphertext.ciphertext = `${ciphertext.ciphertext}tampered`;

    await expect(
      verifySensitiveSample(protection, {
        name: 'beneficiary-phone',
        purpose: 'beneficiary-phone',
        ciphertext,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'FAIL',
        details: { decrypted: false },
      }),
    );
  });
});
