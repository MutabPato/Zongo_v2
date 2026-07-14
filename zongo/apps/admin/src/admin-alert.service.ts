import { Injectable, Logger } from '@nestjs/common';
import type { AdminAlertPort } from './admin.service';

/**
 * Sends sensitive operational events to the deployment's urgent-event
 * channel. Set ADMIN_ALERT_WEBHOOK_URL to a Slack/Teams/PagerDuty-compatible
 * webhook; local development deliberately falls back to a structured log.
 */
@Injectable()
export class AdminAlertService implements AdminAlertPort {
  private readonly logger = new Logger(AdminAlertService.name);

  async sensitiveAction(
    name: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
    const event = {
      severity: 'urgent',
      source: 'zongo-admin-control-plane',
      name,
      occurredAt: new Date().toISOString(),
      details,
    };

    if (!webhookUrl) {
      this.logger.warn(`SENSITIVE_ADMIN_ACTION ${JSON.stringify(event)}`);
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!response.ok)
        this.logger.error(
          `Admin alert delivery failed with HTTP ${response.status}: ${name}`,
        );
    } catch (error) {
      // Alerts must not make an already-completed money operation fail. The
      // structured error keeps the failed alert observable and retryable.
      this.logger.error(`Admin alert delivery failed: ${name}`, error);
    }
  }
}
