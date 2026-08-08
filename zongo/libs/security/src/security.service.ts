import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

export type EncryptionKey = {
  version: string;
  key: Buffer;
};

export interface EncryptionKeyProvider {
  currentKey(purpose: string): Promise<EncryptionKey>;
  keyForVersion(purpose: string, version: string): Promise<EncryptionKey>;
  blindIndexKey(purpose: string): Promise<Buffer>;
}

export const ENVELOPE_ENCRYPTION = Symbol('ENVELOPE_ENCRYPTION');

export class EnvironmentKeyProvider implements EncryptionKeyProvider {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  currentKey(purpose: string): Promise<EncryptionKey> {
    return Promise.resolve(
      this.readEncryptionKey(purpose, this.version(purpose)),
    );
  }

  keyForVersion(purpose: string, version: string): Promise<EncryptionKey> {
    return Promise.resolve(this.readEncryptionKey(purpose, version));
  }

  blindIndexKey(purpose: string): Promise<Buffer> {
    return Promise.resolve(
      this.readKey(`ZONGO_BLIND_INDEX_KEY_${this.normalize(purpose)}`),
    );
  }

  private readEncryptionKey(purpose: string, version: string): EncryptionKey {
    return {
      version,
      key: this.readKey(
        `ZONGO_ENCRYPTION_KEY_${this.normalize(purpose)}_${this.normalize(version)}`,
      ),
    };
  }

  private version(purpose: string): string {
    return (
      this.environment[
        `ZONGO_ENCRYPTION_KEY_VERSION_${this.normalize(purpose)}`
      ] ?? 'V1'
    );
  }

  private readKey(name: string): Buffer {
    const value = this.environment[name];
    if (!value) throw new Error(`${name} is not configured`);
    const key = Buffer.from(value, 'base64url');
    if (key.length !== 32)
      throw new Error(`${name} must be 32 bytes base64url`);
    return key;
  }

  private normalize(value: string): string {
    return value.replace(/[^a-z0-9]/gi, '_').toUpperCase();
  }
}

export type EncryptedValue = {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  iv: string;
  ciphertext: string;
  authTag: string;
};

export class EnvelopeEncryptionService {
  constructor(private readonly keys: EncryptionKeyProvider) {}

  async encrypt(value: string, purpose: string): Promise<EncryptedValue> {
    const key = await this.keys.currentKey(purpose);
    this.assertKey(key.key);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(value, 'utf8')),
      cipher.final(),
    ]);
    return {
      algorithm: 'aes-256-gcm',
      keyVersion: key.version,
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
    };
  }

  async decrypt(value: EncryptedValue, purpose: string): Promise<string> {
    if (value.algorithm !== 'aes-256-gcm')
      throw new Error('Unsupported encryption algorithm');
    const key = await this.keys.keyForVersion(purpose, value.keyVersion);
    this.assertKey(key.key);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key.key,
      Buffer.from(value.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  async reencrypt(
    value: EncryptedValue,
    purpose: string,
  ): Promise<EncryptedValue> {
    return this.encrypt(await this.decrypt(value, purpose), purpose);
  }

  async blindIndex(value: string, purpose: string): Promise<string> {
    const key = await this.keys.blindIndexKey(purpose);
    this.assertKey(key);
    return createHmac('sha256', key)
      .update(value.normalize('NFKC').trim())
      .digest('base64url');
  }

  mask(value: string | null | undefined, visibleSuffix = 4): string | null {
    if (value == null) return null;
    if (value.length <= visibleSuffix) return '••••';
    return `${'•'.repeat(Math.max(4, value.length - visibleSuffix))}${value.slice(-visibleSuffix)}`;
  }

  private assertKey(key: Buffer): void {
    if (key.length !== 32)
      throw new Error('Encryption and blind-index keys must be 32 bytes');
  }
}

const SENSITIVE_AUDIT_KEY =
  /(?:authorization|biometric|document|email|identity|password|payout.?account|phone|provider.?payload|raw.?payload|secret|token)/i;

export function redactSensitivePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitivePayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_AUDIT_KEY.test(key)
        ? '[REDACTED]'
        : redactSensitivePayload(entry),
    ]),
  );
}
