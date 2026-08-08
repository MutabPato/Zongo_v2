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

  it('fails readiness with a dependency-safe error when PostgreSQL is unavailable', async () => {
    const queryRaw = jest
      .fn()
      .mockRejectedValue(new Error('connection secret'));
    const prisma = {
      $queryRaw: queryRaw,
    } as unknown as PrismaService;

    await expect(
      new DatabaseHealthService(prisma).check(),
    ).rejects.toMatchObject({
      status: 503,
      response: { message: 'PostgreSQL is unavailable' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
