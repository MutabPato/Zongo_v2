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
});
