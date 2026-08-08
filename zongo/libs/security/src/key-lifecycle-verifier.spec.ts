import { randomBytes } from 'node:crypto';
import {
  verifyKeyLifecycle,
  type KeyLifecycleVerification,
} from './key-lifecycle-verifier';

function key(): string {
  return randomBytes(32).toString('base64url');
}

function environment(): NodeJS.ProcessEnv {
  return {
    ZONGO_KEY_MANAGEMENT_PROVIDER: 'approved-secret-manager',
    ZONGO_ENCRYPTION_KEY_VERSION_SENDER_PHONE: 'V2',
    ZONGO_ENCRYPTION_KEY_VERSIONS_SENDER_PHONE: 'V1,V2',
    ZONGO_ENCRYPTION_KEY_SENDER_PHONE_V1: key(),
    ZONGO_ENCRYPTION_KEY_SENDER_PHONE_V2: key(),
    ZONGO_BLIND_INDEX_KEY_SENDER_PHONE: key(),
  };
}

describe('verifyKeyLifecycle', () => {
  it('accepts a configured purpose with a retained old version', () => {
    const result: KeyLifecycleVerification = verifyKeyLifecycle(environment(), [
      'sender-phone',
    ]);

    expect(result.status).toBe('PASS');
  });

  it('fails when the current version is retired', () => {
    const env = environment();
    env.ZONGO_RETIRED_ENCRYPTION_KEY_VERSIONS_SENDER_PHONE = 'V2';

    expect(verifyKeyLifecycle(env, ['sender-phone']).status).toBe('FAIL');
  });

  it('fails when the managed provider declaration is absent', () => {
    const env = environment();
    delete env.ZONGO_KEY_MANAGEMENT_PROVIDER;

    expect(verifyKeyLifecycle(env, ['sender-phone']).status).toBe('FAIL');
  });

  it('fails when an encryption key is reused for blind indexes', () => {
    const env = environment();
    env.ZONGO_BLIND_INDEX_KEY_SENDER_PHONE =
      env.ZONGO_ENCRYPTION_KEY_SENDER_PHONE_V2;

    const result = verifyKeyLifecycle(env, ['sender-phone']);

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'encryption-blind-index-key-separation',
          status: 'FAIL',
        }),
      ]),
    );
  });

  it('can require a separate pilot release signing key', () => {
    const env = environment();
    env.PILOT_RELEASE_SIGNING_KEY = key();

    expect(verifyKeyLifecycle(env, ['sender-phone'], true).status).toBe('PASS');
    delete env.PILOT_RELEASE_SIGNING_KEY;
    expect(verifyKeyLifecycle(env, ['sender-phone'], true).status).toBe('FAIL');
  });

  it('rejects a release signing key reused for encryption', () => {
    const env = environment();
    env.PILOT_RELEASE_SIGNING_KEY = env.ZONGO_ENCRYPTION_KEY_SENDER_PHONE_V2;

    expect(verifyKeyLifecycle(env, ['sender-phone'], true).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'pilot-release-signing-key-separation',
          status: 'FAIL',
        }),
      ]),
    );
  });
});
