import { randomBytes } from 'node:crypto';
import {
  EnvironmentKeyProvider,
  EnvelopeEncryptionService,
  redactSensitivePayload,
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
    const replacement = encrypted.ciphertext.endsWith('A') ? 'B' : 'A';
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -1)}${replacement}`,
    };

    await expect(service.decrypt(tampered, 'kyc')).rejects.toThrow();
  });

  it('reencrypts with the current key version', async () => {
    const encrypted = await service.encrypt('identity-secret', 'kyc');

    await expect(service.reencrypt(encrypted, 'kyc')).resolves.toEqual(
      expect.objectContaining({ algorithm: 'aes-256-gcm', keyVersion: 'v2' }),
    );
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

  it('redacts provider identifiers from audit payloads', () => {
    expect(
      redactSensitivePayload({
        partnerReference: 'pretium-secret-ref',
        providerReference: 'openbio-secret-ref',
        status: 'COMPLETE',
      }),
    ).toEqual({
      partnerReference: '[REDACTED]',
      providerReference: '[REDACTED]',
      status: 'COMPLETE',
    });
  });

  it('fails closed for retired encryption versions', async () => {
    const keys = new EnvironmentKeyProvider({
      ZONGO_RETIRED_ENCRYPTION_KEY_VERSIONS_KYC: 'v1, v2',
      ZONGO_ENCRYPTION_KEY_KYC_V3: key.toString('base64url'),
      ZONGO_ENCRYPTION_KEY_VERSION_KYC: 'v3',
    });
    expect(() => keys.keyForVersion('kyc', 'v1')).toThrow(
      'retired or compromised',
    );
    expect(await keys.currentKey('kyc')).toEqual({
      version: 'v3',
      key,
    });
  });
});
