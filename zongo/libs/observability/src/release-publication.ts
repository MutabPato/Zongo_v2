import { createHash } from 'node:crypto';

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
