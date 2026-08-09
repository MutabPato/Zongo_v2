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
  reason?: string;
  allowlistRequired?: boolean;
  maxPendingTransfers?: number | null;
  maxAmbiguousTransfers?: number | null;
  maxPartnerSettlementMinor?: string | null;
  maxRecoveryCapacity?: number | null;
  globalDailySendMinor?: string | null;
};

export const AdminV1OpenApiSchemas: Record<string, OpenApiSchema> = {
  session: {
    type: 'object',
    required: [
      'id',
      'userId',
      'role',
      'mfaVerifiedAt',
      'blockedAt',
      'expiresAt',
      'lastUsedAt',
      'source',
      'capabilities',
    ],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      role: { type: 'string', enum: ['SUPPORT', 'OPS', 'ADMIN'] },
      mfaVerifiedAt: { type: 'string', format: 'date-time' },
      blockedAt: { type: 'string', format: 'date-time', nullable: true },
      expiresAt: { type: 'string', format: 'date-time' },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
      source: { type: 'string' },
      capabilities: {
        type: 'object',
        additionalProperties: { type: 'boolean' },
      },
    },
  },
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
    required: ['reason'],
    properties: {
      reason: { type: 'string' },
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

export function parseWebAuthnLogin(input: unknown): WebAuthnLoginBody {
  const body = objectBody(input);
  return {
    userId: requiredString(body.userId, 'userId'),
    response: parseRecord(
      body.response,
      'response',
    ) as unknown as WebAuthnLoginBody['response'],
  };
}

export function parseWebAuthnRegistration(
  input: unknown,
): WebAuthnRegistrationBody {
  const body = objectBody(input);
  return {
    response: parseRecord(
      body.response,
      'response',
    ) as unknown as WebAuthnRegistrationBody['response'],
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

export function parseRetryPayout(input: unknown): RetryPayoutBody {
  const body = objectBody(input);
  if (body.correctedBeneficiaryId === undefined) return {};
  return {
    correctedBeneficiaryId: requiredString(
      body.correctedBeneficiaryId,
      'correctedBeneficiaryId',
    ),
  };
}

export function parseReconciliationAssignment(
  input: unknown,
): ReconciliationAssignmentBody {
  const body = objectBody(input);
  return {
    ownerIdentityId: requiredString(body.ownerIdentityId, 'ownerIdentityId'),
    reason: requiredString(body.reason, 'reason'),
    ...(body.escalate === undefined
      ? {}
      : { escalate: requiredBoolean(body.escalate, 'escalate') }),
  };
}

export function parseVerificationReview(
  input: unknown,
): VerificationReviewBody {
  const body = objectBody(input);
  const decision = requiredString(
    body.decision,
    'decision',
  ) as VerificationReviewBody['decision'];
  if (!['APPROVED', 'REJECTED', 'ESCALATED'].includes(decision))
    throw new BadRequestException('decision is invalid');
  return {
    decision,
    decisionReason: requiredString(body.decisionReason, 'decisionReason'),
  };
}

export function parseUserBlock(input: unknown): UserBlockBody {
  const body = objectBody(input);
  return {
    userId: requiredString(body.userId, 'userId'),
    blocked: requiredBoolean(body.blocked, 'blocked'),
    ...(body.reason === undefined
      ? {}
      : { reason: requiredString(body.reason, 'reason') }),
  };
}

export function parseTierOneCaps(input: unknown): TierOneCapsBody {
  const body = objectBody(input);
  return {
    perTransferLimitMinor: parseDecimal(
      body.perTransferLimitMinor,
      'perTransferLimitMinor',
    ),
    dailyLimitMinor: parseDecimal(body.dailyLimitMinor, 'dailyLimitMinor'),
  };
}

export function parsePilotControl(input: unknown): PilotControlBody {
  const body = objectBody(input);
  return {
    key: requiredString(body.key, 'key'),
    state: requiredString(body.state, 'state'),
    reason: requiredString(body.reason, 'reason'),
  };
}

export function parsePilotAllowlist(input: unknown): PilotAllowlistBody {
  const body = objectBody(input);
  return {
    senderProfileId: requiredString(body.senderProfileId, 'senderProfileId'),
    enabled: requiredBoolean(body.enabled, 'enabled'),
    reason: requiredString(body.reason, 'reason'),
  };
}

export function parseExposurePolicy(input: unknown): ExposurePolicyBody {
  const body = objectBody(input);
  const numberField = (field: keyof ExposurePolicyBody) =>
    body[field] === undefined || body[field] === null
      ? (body[field] as number | null | undefined)
      : requiredFiniteNumber(body[field], field);
  const decimalField = (field: keyof ExposurePolicyBody) =>
    body[field] === undefined || body[field] === null
      ? (body[field] as string | null | undefined)
      : parseDecimal(body[field], field);
  return {
    reason: requiredString(body.reason, 'reason'),
    ...(body.allowlistRequired === undefined
      ? {}
      : {
          allowlistRequired: requiredBoolean(
            body.allowlistRequired,
            'allowlistRequired',
          ),
        }),
    maxPendingTransfers: numberField('maxPendingTransfers'),
    maxAmbiguousTransfers: numberField('maxAmbiguousTransfers'),
    maxPartnerSettlementMinor: decimalField('maxPartnerSettlementMinor'),
    maxRecoveryCapacity: numberField('maxRecoveryCapacity'),
    globalDailySendMinor: decimalField('globalDailySendMinor'),
  };
}

export function parsePilotApproval(input: unknown): PilotApprovalBody {
  const body = objectBody(input);
  return {
    role: requiredString(body.role, 'role'),
    note: requiredString(body.note, 'note'),
  };
}

export function parsePilotStage(input: unknown): PilotStageBody {
  const body = objectBody(input);
  return {
    stage: requiredString(body.stage, 'stage'),
    evidenceRefs: parseStringRecord(body.evidenceRefs, 'evidenceRefs'),
    ...(body.approvedCohort === undefined
      ? {}
      : { approvedCohort: parseRecord(body.approvedCohort, 'approvedCohort') }),
    ...(body.numericLimits === undefined
      ? {}
      : { numericLimits: parseRecord(body.numericLimits, 'numericLimits') }),
    ...(body.releaseConfiguration === undefined
      ? {}
      : {
          releaseConfiguration: parseRecord(
            body.releaseConfiguration,
            'releaseConfiguration',
          ),
        }),
    ...(body.rollbackPlan === undefined
      ? {}
      : { rollbackPlan: requiredString(body.rollbackPlan, 'rollbackPlan') }),
  };
}

export function parsePilotPublish(input: unknown): PilotPublishBody {
  const body = objectBody(input);
  return {
    approvedCohort: parseRecord(body.approvedCohort, 'approvedCohort'),
    numericLimits: parseRecord(body.numericLimits, 'numericLimits'),
    releaseConfiguration: parseRecord(
      body.releaseConfiguration,
      'releaseConfiguration',
    ),
    rollbackPlan: requiredString(body.rollbackPlan, 'rollbackPlan'),
    evidenceRefs: parseStringRecord(body.evidenceRefs, 'evidenceRefs'),
    noWaiverConfirmed: requiredBoolean(
      body.noWaiverConfirmed,
      'noWaiverConfirmed',
    ),
  };
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

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new BadRequestException(`${field} must be a non-negative number`);
  return value;
}

function parseStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  const record = parseRecord(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      requiredString(entry, `${field}.${key}`),
    ]),
  );
}
