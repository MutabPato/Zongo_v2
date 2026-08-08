/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { PrismaService } from '@app/db';
import { AdminAlertDispatcher } from './admin-alert-dispatcher.service';

describe('AdminAlertDispatcher', () => {
  it('contains a Postgres outage and leaves alerts pending for retry', async () => {
    const prisma = {
      adminAlertDelivery: {
        findMany: jest.fn().mockRejectedValue(new Error('connection refused')),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminAlertDispatcher(prisma).dispatch(),
    ).resolves.toBeUndefined();
  });

  it('records escalation evidence when an urgent alert exhausts delivery retries', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
      callback({
        adminAlertDelivery: { updateMany },
        auditEvent: { create: auditCreate },
      }),
    );
    const prisma = {
      adminAlertDelivery: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'alert_1',
            auditEventId: 'audit_source',
            actionName: 'pilot.exposure.urgent',
            attempts: 4,
            severity: 'URGENT',
            escalatedAt: null,
            payload: { severity: 'urgent', metric: 'pending' },
          },
        ]),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    process.env.ADMIN_ALERT_WEBHOOK_URL = 'https://alerts.example.test';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network unavailable'));

    await new AdminAlertDispatcher(prisma).dispatch();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://alerts.example.test',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(transaction).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'alert_1', escalatedAt: null },
      data: expect.objectContaining({
        status: 'FAILED',
        attempts: { increment: 1 },
        escalatedAt: expect.any(Date),
        nextAttemptAt: null,
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'TECHNICAL',
        name: 'admin.alert.delivery.escalated',
        payload: {
          alertId: 'alert_1',
          actionName: 'pilot.exposure.urgent',
          severity: 'URGENT',
          attempts: 5,
        },
      }),
    });

    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
    fetchMock.mockRestore();
  });
});
