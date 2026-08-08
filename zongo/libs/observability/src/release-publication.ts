import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type PilotReleasePublicationSnapshot = {
  approvedCohort: unknown;
  numericLimits: unknown;
  releaseConfiguration: unknown;
  rollbackPlan: string;
  evidenceRefs: unknown;
  noWaiverConfirmed: boolean;
  approvals?: unknown;
  stageRecords?: unknown;
  publishedAt?: string;
  publishedByIdentityId?: string;
};

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  return value;
}

/** Hashes the exact non-secret release facts without exposing them in audit logs. */
export function hashPilotReleasePublication(
  snapshot: PilotReleasePublicationSnapshot,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex');
}

function decodeSigningKey(signingKey: string): Buffer {
  const key = Buffer.from(signingKey, 'base64url');
  if (key.length !== 32)
    throw new Error('Pilot release signing key must be 32 bytes base64url');
  return key;
}

/** Signs the canonical publication fingerprint with the release authority key. */
export function signPilotReleasePublication(
  publicationHash: string,
  signingKey: string,
): string {
  return createHmac('sha256', decodeSigningKey(signingKey))
    .update(publicationHash)
    .digest('base64url');
}

/** Verifies a stored release signature without exposing the signing key. */
export function verifyPilotReleasePublicationSignature(
  publicationHash: string,
  signature: string | null | undefined,
  signingKey: string | undefined,
): boolean {
  if (!signature || !signingKey) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(
      signPilotReleasePublication(publicationHash, signingKey),
      'base64url',
    );
  } catch {
    return false;
  }
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
