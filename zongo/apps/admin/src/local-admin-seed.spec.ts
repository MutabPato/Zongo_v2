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

  it('supports an explicitly configured non-admin local role', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'support_1' });

    await upsertLocalAdmin(
      { platformIdentity: { upsert } },
      {
        email: 'support@zongo.app',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        role: AdminRole.SUPPORT,
      },
    );

    const calls = upsert.mock.calls as unknown as Array<[unknown]>;
    const args = calls[0]?.[0] as
      | { create?: { role?: AdminRole }; update?: { role?: AdminRole } }
      | undefined;
    expect(args?.create?.role).toBe(AdminRole.SUPPORT);
    expect(args?.update?.role).toBe(AdminRole.SUPPORT);
  });
});
