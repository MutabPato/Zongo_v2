import { AuditService } from './audit.service';
import type { PrismaService } from '@app/db';
import type { AuditEvent as PrismaAuditEvent } from '@prisma/client';

describe('AuditService', () => {
  it('appends audit events through prisma create only', async () => {
    const auditEventCreate = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      auditEvent: {
        create: auditEventCreate,
      },
    } as unknown as PrismaService;

    const service = new AuditService(prisma);

    const event: PrismaAuditEvent = {
      id: 'audit_1',
      eventType: 'BUSINESS',
      name: 'transfer.created',
      actorType: null,
      actorId: 'user_1',
      corridorId: null,
      transactionId: 'tx_1',
      payload: { amount: 100 },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    await service.append(event);

    expect(auditEventCreate).toHaveBeenCalledTimes(1);
    expect(auditEventCreate).toHaveBeenCalledWith({
      data: {
        id: 'audit_1',
        eventType: 'BUSINESS',
        name: 'transfer.created',
        actorType: null,
        actorId: 'user_1',
        corridorId: null,
        transactionId: 'tx_1',
        payload: { amount: 100 },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });
});
