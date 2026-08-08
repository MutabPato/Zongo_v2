/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { AuditLogPort } from '@app/domain';
import type { PrismaService } from '@app/db';
import { PilotExposureMonitor } from './pilot-exposure-monitor.service';

describe('PilotExposureMonitor', () => {
  it('emits a warning at 80 percent and urgently pauses initiation at the hard limit', async () => {
    const signalFind = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ severity: 'WARNING' });
    const signalUpsert = jest.fn().mockResolvedValue(undefined);
    const auditCreate = jest.fn().mockResolvedValue(undefined);
    const alertCreate = jest.fn().mockResolvedValue(undefined);
    const controlFind = jest.fn().mockResolvedValue({ state: 'ENABLED' });
    const controlUpsert = jest.fn().mockResolvedValue(undefined);
    const tx = {
      pilotExposureSignal: { findUnique: signalFind, upsert: signalUpsert },
      auditEvent: { create: auditCreate },
      adminAlertDelivery: { create: alertCreate },
      pilotControl: { findUnique: controlFind, upsert: controlUpsert },
    };
    const prisma = {
      pilotExposurePolicy: {
        findUnique: jest.fn().mockResolvedValue({
          maxPendingTransfers: 10,
          maxAmbiguousTransfers: null,
          maxRecoveryCapacity: null,
          globalDailySendMinor: null,
        }),
      },
      transferTransaction: {
        count: jest.fn().mockResolvedValue(8),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { sendAmountMinor: 0n } }),
      },
      whatsAppSession: { count: jest.fn().mockResolvedValue(0) },
      pilotExposureSignal: { findUnique: signalFind },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogPort;
    const monitor = new PilotExposureMonitor(prisma, audit);

    await monitor.evaluate();
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionName: 'pilot.exposure.warning',
          severity: 'WARNING',
        }),
      }),
    );

    (prisma.transferTransaction.count as jest.Mock).mockResolvedValue(10);
    await monitor.evaluate();
    expect(controlUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ state: 'PAUSED' }),
        update: expect.objectContaining({ state: 'PAUSED' }),
      }),
    );
  });
});
