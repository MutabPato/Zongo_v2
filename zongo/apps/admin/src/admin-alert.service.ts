import { Injectable, Logger } from '@nestjs/common';
import type { AdminAlertPort } from './admin.service';
import { PrismaService } from '@app/db';
import { Prisma } from '@prisma/client';

/**
 * Sends sensitive operational events to the deployment's urgent-event
 * channel. Set ADMIN_ALERT_WEBHOOK_URL to a Slack/Teams/PagerDuty-compatible
 * webhook; local development deliberately falls back to a structured log.
 */
@Injectable()
export class AdminAlertService implements AdminAlertPort {
  private readonly logger = new Logger(AdminAlertService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sensitiveAction(
    name: string,
    details: Record<string, unknown>,
    auditEventId: string,
  ): Promise<void> {
    try {
      await this.prisma.adminAlertDelivery.create({
        data: {
          auditEventId,
          actionName: name,
          payload: {
            severity: 'urgent',
            source: 'zongo-admin-control-plane',
            name,
            occurredAt: new Date().toISOString(),
            details,
          } as Prisma.InputJsonValue,
          nextAttemptAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not enqueue sensitive admin alert: ${name}`,
        error,
      );
    }
  }
}
