import type { PrismaService } from './prisma.service';
import { DatabaseHealthService } from './database-health.service';

describe('DatabaseHealthService', () => {
  it('runs a lightweight database query for readiness', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const prisma = {
      $queryRaw: queryRaw,
    } as unknown as PrismaService;

    await expect(
      new DatabaseHealthService(prisma).check(),
    ).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
