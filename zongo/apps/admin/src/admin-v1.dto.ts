import { BadRequestException } from '@nestjs/common';

export type LoginBody = { userId: string; totpCode: string };
export type BreakGlassBody = {
  userId: string;
  emergencySecret: string;
  reason: string;
};
export type NoteBody = { body: string };
export type UserIdBody = { userId: string };
export type RetryPayoutBody = { correctedBeneficiaryId?: string };
export type WebAuthnLoginBody = {
  userId: string;
  response: Record<string, unknown>;
};
export type WebAuthnRegistrationBody = { response: Record<string, unknown> };
export type AlertReasonBody = { reason: string };
export type ReconciliationAssignmentBody = {
  ownerIdentityId: string;
  reason: string;
  escalate?: boolean;
};
export type VerificationReviewBody = {
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED';
  decisionReason: string;
};
export type UserBlockBody = {
  userId: string;
  blocked: boolean;
  reason?: string;
};
export type TierOneCapsBody = {
  perTransferLimitMinor: string;
  dailyLimitMinor: string;
};
export type PilotControlBody = { key: string; state: string; reason: string };
export type PilotAllowlistBody = {
  senderProfileId: string;
  enabled: boolean;
  reason: string;
};
export type PilotApprovalBody = { role: string; note: string };
export type PilotStageBody = {
  stage: string;
  evidenceRefs: Record<string, string>;
  approvedCohort?: Record<string, unknown>;
  numericLimits?: Record<string, unknown>;
  releaseConfiguration?: Record<string, unknown>;
  rollbackPlan?: string;
};
export type PilotPublishBody = {
  approvedCohort: Record<string, unknown>;
  numericLimits: Record<string, unknown>;
  releaseConfiguration: Record<string, unknown>;
  rollbackPlan: string;
  evidenceRefs: Record<string, string>;
  noWaiverConfirmed: boolean;
};
export type ExposurePolicyBody = {
  allowlistRequired?: boolean;
  maxPendingTransfers?: number | null;
  maxAmbiguousTransfers?: number | null;
  maxPartnerSettlementMinor?: string | null;
  maxRecoveryCapacity?: number | null;
  globalDailySendMinor?: string | null;
};

function objectBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('A JSON object body is required');
  return input as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException(`${field} is required`);
  return value.trim();
}

export function parseLogin(input: unknown): LoginBody {
  const body = objectBody(input);
  const userId = requiredString(body.userId, 'userId');
  const totpCode = requiredString(body.totpCode, 'totpCode');
  if (!/^\d{6}$/.test(totpCode))
    throw new BadRequestException('totpCode must be a six-digit code');
  return { userId, totpCode };
}

export function parseBreakGlass(input: unknown): BreakGlassBody {
  const body = objectBody(input);
  return {
    userId: requiredString(body.userId, 'userId'),
    emergencySecret: requiredString(body.emergencySecret, 'emergencySecret'),
    reason: requiredString(body.reason, 'reason'),
  };
}

export function parseNote(input: unknown): NoteBody {
  const body = objectBody(input);
  return { body: requiredString(body.body, 'body') };
}

export function parseReason(input: unknown): AlertReasonBody {
  const body = objectBody(input);
  return { reason: requiredString(body.reason, 'reason') };
}

export function parseDecimal(value: unknown, field: string): string {
  const decimal = requiredString(value, field);
  if (!/^\d+$/.test(decimal))
    throw new BadRequestException(
      `${field} must be a non-negative decimal string`,
    );
  return decimal;
}

export function parseRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(`${field} must be an object`);
  return value as Record<string, unknown>;
}
