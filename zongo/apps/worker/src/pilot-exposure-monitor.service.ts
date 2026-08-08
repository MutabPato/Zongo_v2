import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@app/db';
import { AUDIT_LOG_PORT, type AuditLogPort } from '@app/domain';
import { PilotControlState } from '@prisma/client';

type ExposureMetric = {
  key: string;
  observed: bigint;
  limit: bigint | null | undefined;
};

@Injectable()
export class PilotExposureMonitor {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_PORT) private readonly audit: AuditLogPort,
  ) {}

  async evaluate(): Promise<void> {
    const policy = await this.prisma.pilotExposurePolicy.findUnique({
      where: { id: 'pilot' },
    });
    if (!policy) return;
    const pending = await this.prisma.transferTransaction.count({
      where: {
        status: { in: ['INITIATED', 'PENDING_COLLECTION', 'PENDING_PAYOUT'] },
      },
    });
    const ambiguous = await this.prisma.whatsAppSession.count({
      where: { status: 'WAITING' },
    });
    const recovery = await this.prisma.transferTransaction.count({
      where: { status: 'PAYOUT_FAILED' },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daily = await this.prisma.transferTransaction.aggregate({
      where: { createdAt: { gte: today } },
      _sum: { sendAmountMinor: true },
    });
    const metrics: ExposureMetric[] = [
      {
        key: 'pending',
        observed: BigInt(pending),
        limit:
          policy.maxPendingTransfers === null
            ? null
            : BigInt(policy.maxPendingTransfers),
      },
      {
        key: 'ambiguous',
        observed: BigInt(ambiguous),
        limit:
          policy.maxAmbiguousTransfers === null
            ? null
            : BigInt(policy.maxAmbiguousTransfers),
      },
      {
        key: 'recovery',
        observed: BigInt(recovery),
        limit:
          policy.maxRecoveryCapacity === null
            ? null
            : BigInt(policy.maxRecoveryCapacity),
      },
      {
        key: 'global-daily-send-minor',
        observed: daily._sum.sendAmountMinor ?? 0n,
        limit: policy.globalDailySendMinor,
      },
    ];
    for (const metric of metrics) await this.evaluateMetric(metric);
  }

  private async evaluateMetric(metric: ExposureMetric): Promise<void> {
    if (
      metric.limit === null ||
      metric.limit === undefined ||
      metric.limit <= 0n
    )
      return;
    const warningThreshold = (metric.limit * 80n + 99n) / 100n;
    const severity =
      metric.observed >= metric.limit
        ? 'URGENT'
        : metric.observed >= warningThreshold
          ? 'WARNING'
          : 'NORMAL';
    const previous = await this.prisma.pilotExposureSignal.findUnique({
      where: { key: metric.key },
    });
    if (severity === 'NORMAL') {
      if (previous)
        await this.prisma.pilotExposureSignal.update({
          where: { key: metric.key },
          data: {
            severity,
            observedValue: metric.observed,
            threshold: metric.limit,
          },
        });
      return;
    }
    if (previous?.severity === severity) return;
    const auditId = crypto.randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.pilotExposureSignal.upsert({
        where: { key: metric.key },
        create: {
          key: metric.key,
          severity,
          observedValue: metric.observed,
          threshold: metric.limit!,
          lastEmittedAt: new Date(),
        },
        update: {
          severity,
          observedValue: metric.observed,
          threshold: metric.limit!,
          lastEmittedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: auditId,
          eventType: 'TECHNICAL',
          name: `pilot.exposure.${severity.toLowerCase()}`,
          payload: {
            metric: metric.key,
            observed: metric.observed.toString(),
            threshold: metric.limit!.toString(),
          },
          createdAt: new Date(),
        },
      });
      await tx.adminAlertDelivery.create({
        data: {
          auditEventId: auditId,
          actionName: `pilot.exposure.${severity.toLowerCase()}`,
          severity,
          payload: {
            severity: severity.toLowerCase(),
            metric: metric.key,
            observed: metric.observed.toString(),
            threshold: metric.limit!.toString(),
          },
          nextAttemptAt: new Date(),
        },
      });
      if (severity === 'URGENT') {
        const control = await tx.pilotControl.findUnique({
          where: { key: 'INITIATION' },
        });
        if (control?.state !== PilotControlState.PERMANENTLY_STOPPED)
          await tx.pilotControl.upsert({
            where: { key: 'INITIATION' },
            create: {
              key: 'INITIATION',
              state: PilotControlState.PAUSED,
              reason: `Automatic exposure pause: ${metric.key}`,
            },
            update: {
              state: PilotControlState.PAUSED,
              reason: `Automatic exposure pause: ${metric.key}`,
            },
          });
      }
    });
    await this.audit.append({
      id: crypto.randomUUID(),
      eventType: 'TECHNICAL',
      name: `pilot.exposure.${severity.toLowerCase()}.emitted`,
      payload: { metric: metric.key },
      createdAt: new Date(),
    });
  }
}
