export type AuditEventType = 'BUSINESS' | 'TECHNICAL';

export interface AuditEvent {
  readonly id: string;
  readonly type: AuditEventType;
  readonly name: string;
  readonly actorId?: string;
  readonly transactionId?: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface AuditLogPort {
  append(event: AuditEvent): Promise<void>;
}
