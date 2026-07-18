import { AdminRole } from '@prisma/client';
import { upsertLocalAdmin } from './local-admin-seed';

describe('upsertLocalAdmin', () => {
  it('creates an unblocked admin with the configured TOTP secret', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'admin_1' });

    await upsertLocalAdmin(
      { platformIdentity: { upsert } },
      {
        email: 'admin@zongo.app',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'admin@zongo.app' },
      create: {
        userId: 'admin@zongo.app',
        role: AdminRole.ADMIN,
        totpSecret: 'JBSWY3DPEHPK3PXP',
        blockedAt: null,
      },
      update: {
        role: AdminRole.ADMIN,
        totpSecret: 'JBSWY3DPEHPK3PXP',
        blockedAt: null,
        blockedReason: null,
        blockedById: null,
      },
    });
  });
});
