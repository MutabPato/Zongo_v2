import { randomBytes } from 'node:crypto';
import {
  EnvelopeEncryptionService,
  type EncryptionKeyProvider,
} from './security.service';

describe('EnvelopeEncryptionService', () => {
  const key = randomBytes(32);
  const provider: EncryptionKeyProvider = {
    currentKey: jest.fn().mockResolvedValue({ version: 'v2', key }),
    keyForVersion: jest.fn().mockResolvedValue({ version: 'v2', key }),
    blindIndexKey: jest.fn().mockResolvedValue(key),
  };
  const service = new EnvelopeEncryptionService(provider);

  it('round-trips plaintext using authenticated envelope encryption', async () => {
    const encrypted = await service.encrypt('identity-secret', 'kyc');

    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.ciphertext).not.toContain('identity-secret');
    await expect(service.decrypt(encrypted, 'kyc')).resolves.toBe(
      'identity-secret',
    );
  });

  it('rejects tampered ciphertext', async () => {
    const encrypted = await service.encrypt('identity-secret', 'kyc');
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
    };

    await expect(service.decrypt(tampered, 'kyc')).rejects.toThrow();
  });

  it('creates stable keyed indexes without exposing the input', async () => {
    const first = await service.blindIndex(' +254700000001 ', 'phone');
    const second = await service.blindIndex('+254700000001', 'phone');

    expect(first).toBe(second);
    expect(first).not.toContain('254700000001');
  });

  it('masks restricted values while retaining a short support suffix', () => {
    expect(service.mask('+254700000001')).toBe('•••••••••0001');
    expect(service.mask('abc')).toBe('••••');
    expect(service.mask(null)).toBeNull();
  });
});
