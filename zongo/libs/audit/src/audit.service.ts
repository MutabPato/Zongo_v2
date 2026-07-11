import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/db';
import { AuditEvent } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: AuditEvent): Promise<void> {
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
