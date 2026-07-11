export type AuditEventType = 'BUSINESS' | 'TECHNICAL';

export interface NewAuditEvent {
  readonly id: string;
  readonly eventType: AuditEventType;
  readonly name: string;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly corridorId?: string;
  readonly transactionId?: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

/** Append-only audit boundary used by application services. */
export interface AuditLogPort {
  append(event: NewAuditEvent): Promise<void>;
}

export const AUDIT_LOG_PORT = Symbol('AUDIT_LOG_PORT');
