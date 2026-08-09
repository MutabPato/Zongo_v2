import { BadRequestException } from '@nestjs/common';
import type { WebAuthnService } from './webauthn.service';

type OpenApiSchema = {
  type?: string;
  required?: string[];
  pattern?: string;
  enum?: string[];
  format?: string;
  nullable?: boolean;
  additionalProperties?: boolean | OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
};

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
  response: Parameters<WebAuthnService['verifyAuthentication']>[1];
};
export type WebAuthnRegistrationBody = {
  response: Parameters<WebAuthnService['verifyRegistration']>[1];
};
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

export const AdminV1OpenApiSchemas: Record<string, OpenApiSchema> = {
  login: {
    type: 'object',
    required: ['userId', 'totpCode'],
    properties: {
      userId: { type: 'string' },
      totpCode: { type: 'string', pattern: '^\\d{6}$' },
    },
  },
  breakGlass: {
    type: 'object',
    required: ['userId', 'emergencySecret', 'reason'],
    properties: {
      userId: { type: 'string' },
      emergencySecret: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  note: {
    type: 'object',
    required: ['body'],
    properties: { body: { type: 'string' } },
  },
  reason: {
    type: 'object',
    required: ['reason'],
    properties: { reason: { type: 'string' } },
  },
  retryPayout: {
    type: 'object',
    properties: { correctedBeneficiaryId: { type: 'string' } },
  },
  reconciliationAssignment: {
    type: 'object',
    required: ['ownerIdentityId', 'reason'],
    properties: {
      ownerIdentityId: { type: 'string' },
      reason: { type: 'string' },
      escalate: { type: 'boolean' },
    },
  },
  verificationReview: {
    type: 'object',
    required: ['decision', 'decisionReason'],
    properties: {
      decision: { type: 'string', enum: ['APPROVED', 'REJECTED', 'ESCALATED'] },
      decisionReason: { type: 'string' },
    },
  },
  tierCaps: {
    type: 'object',
    required: ['perTransferLimitMinor', 'dailyLimitMinor'],
    properties: {
      perTransferLimitMinor: { type: 'string', pattern: '^\\d+$' },
      dailyLimitMinor: { type: 'string', pattern: '^\\d+$' },
    },
  },
  pilotControl: {
    type: 'object',
    required: ['key', 'state', 'reason'],
    properties: {
      key: { type: 'string' },
      state: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  userBlock: {
    type: 'object',
    required: ['userId', 'blocked'],
    properties: {
      userId: { type: 'string' },
      blocked: { type: 'boolean' },
      reason: { type: 'string' },
    },
  },
  pilotAllowlist: {
    type: 'object',
    required: ['senderProfileId', 'enabled', 'reason'],
    properties: {
      senderProfileId: { type: 'string' },
      enabled: { type: 'boolean' },
      reason: { type: 'string' },
    },
  },
  exposurePolicy: {
    type: 'object',
    properties: {
      allowlistRequired: { type: 'boolean' },
      maxPendingTransfers: { type: 'integer', nullable: true },
      maxAmbiguousTransfers: { type: 'integer', nullable: true },
      maxPartnerSettlementMinor: { type: 'string', nullable: true },
      maxRecoveryCapacity: { type: 'integer', nullable: true },
      globalDailySendMinor: { type: 'string', nullable: true },
    },
  },
  pilotApproval: {
    type: 'object',
    required: ['role', 'note'],
    properties: { role: { type: 'string' }, note: { type: 'string' } },
  },
  pilotStage: {
    type: 'object',
    required: ['stage', 'evidenceRefs'],
    properties: {
      stage: { type: 'string' },
      evidenceRefs: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
  },
  pilotPublish: {
    type: 'object',
    required: [
      'approvedCohort',
      'numericLimits',
      'releaseConfiguration',
      'rollbackPlan',
      'evidenceRefs',
      'noWaiverConfirmed',
    ],
    properties: {
      approvedCohort: { type: 'object' },
      numericLimits: { type: 'object' },
      releaseConfiguration: { type: 'object' },
      rollbackPlan: { type: 'string' },
      evidenceRefs: { type: 'object' },
      noWaiverConfirmed: { type: 'boolean' },
    },
  },
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

export function parseUserId(input: unknown): UserIdBody {
  const body = objectBody(input);
  return { userId: requiredString(body.userId, 'userId') };
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
