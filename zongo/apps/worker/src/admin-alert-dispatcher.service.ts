import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AdminAlertDeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@app/db';

/** Delivers the admin alert outbox with bounded exponential retries. */
@Injectable()
export class AdminAlertDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminAlertDispatcher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatch(), 5_000);
    void this.dispatch();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deliveries = await this.prisma.adminAlertDelivery.findMany({
        where: {
          status: {
            in: [
              AdminAlertDeliveryStatus.PENDING,
              AdminAlertDeliveryStatus.FAILED,
            ],
          },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const delivery of deliveries) await this.deliver(delivery);
    } finally {
      this.running = false;
    }
  }

  private async deliver(delivery: {
    id: string;
    attempts: number;
    payload: Prisma.JsonValue;
  }): Promise<void> {
    const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn(
        `Admin alert ${delivery.id} pending: webhook is not configured`,
      );
      return;
    }
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delivery.payload),
      });
      if (!response.ok)
        throw new Error(`Webhook responded HTTP ${response.status}`);
      await this.prisma.adminAlertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: AdminAlertDeliveryStatus.DELIVERED,
          attempts: { increment: 1 },
          deliveredAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const retryable = attempts < 5;
      await this.prisma.adminAlertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: AdminAlertDeliveryStatus.FAILED,
          attempts: { increment: 1 },
          lastError:
            error instanceof Error ? error.message : 'Alert delivery failed',
          nextAttemptAt: retryable
            ? new Date(Date.now() + 1_000 * 2 ** attempts)
            : null,
        },
      });
    }
  }
}
