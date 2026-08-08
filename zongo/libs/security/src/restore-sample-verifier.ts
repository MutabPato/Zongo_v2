import type { EncryptedValue, EnvelopeEncryptionService } from './security.service';

export type RestoreCheck = {
  name: string;
  status: 'PASS' | 'SKIPPED' | 'FAIL';
  details: Record<string, number | string | boolean>;
};

export type SensitiveSample = {
  name: string;
  purpose: string;
  ciphertext: unknown;
  blindIndex?: string | null;
  verifyBlindIndex?: boolean;
};

/** Verifies one encrypted restore sample without exposing its plaintext. */
export async function verifySensitiveSample(
  protection: EnvelopeEncryptionService,
  sample: SensitiveSample,
): Promise<RestoreCheck> {
  if (!sample.ciphertext)
    return {
      name: sample.name,
      status: 'SKIPPED',
      details: { reason: 'No encrypted sample exists' },
    };

  try {
    const serialized =
      typeof sample.ciphertext === 'string'
        ? (JSON.parse(sample.ciphertext) as unknown)
        : sample.ciphertext;
    const plaintext = await protection.decrypt(
      serialized as EncryptedValue,
      sample.purpose,
    );
    let blindIndexMatches = true;
    if (sample.verifyBlindIndex) {
      const derivedIndex = await protection.blindIndex(
        plaintext,
        sample.purpose,
      );
      blindIndexMatches = sample.blindIndex === derivedIndex;
    }
    return {
      name: sample.name,
      status: blindIndexMatches ? 'PASS' : 'FAIL',
      details: {
        decrypted: true,
        ...(sample.verifyBlindIndex ? { blindIndexMatches } : {}),
      },
    };
  } catch {
    return {
      name: sample.name,
      status: 'FAIL',
      details: { decrypted: false },
    };
  }
}
