import type { PrismaService } from '@app/db';
import { WorkerMetricsService } from './worker-metrics.service';

describe('WorkerMetricsService', () => {
  it('returns aggregate operational facts without identifiers', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      transferTransaction: { count },
      workerJob: { count },
      senderVerification: { count },
      notificationIntent: { count },
      transactionReconciliation: { count },
      pilotControl: { count },
      adminAlertDelivery: { count },
      auditEvent: { count },
      platformIdentity: { count },
    } as unknown as PrismaService;

    const result = await new WorkerMetricsService(prisma).snapshot();

    expect(result.transfers.total).toBe(0);
    expect(result.worker.jobsByType.RECONCILIATION).toBe(0);
    expect(result.partner.callbackEvents).toBe(0);
    expect(result.security.blockedIdentities).toBe(0);
    expect(result.dependencies.redisRebuildable).toBe(true);
    expect(result).not.toHaveProperty('customerPhone');
    expect(count).toHaveBeenCalled();
  });
});
