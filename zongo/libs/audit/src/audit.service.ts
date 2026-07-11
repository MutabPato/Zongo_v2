import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/db';
import { Prisma } from '@prisma/client';
import { type AuditLogPort, type NewAuditEvent } from '@app/domain';

@Injectable()
export class AuditService implements AuditLogPort {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: NewAuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        eventType: event.eventType,
        name: event.name,
        actorType: event.actorType,
        actorId: event.actorId,
        corridorId: event.corridorId,
        transactionId: event.transactionId,
        payload: event.payload as Prisma.InputJsonValue,
        createdAt: event.createdAt,
      },
    });
  }
}
