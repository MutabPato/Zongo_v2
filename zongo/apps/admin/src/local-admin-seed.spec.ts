import { AdminRole } from '@prisma/client';
import {
  localAdminConfigsFromEnvironment,
  upsertLocalAdmin,
} from './local-admin-seed';

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

  it('derives all three synthetic role fixtures only when explicitly configured', () => {
    expect(
      localAdminConfigsFromEnvironment({
        LOCAL_ADMIN_EMAIL: 'admin@zongo.app',
        LOCAL_ADMIN_TOTP_SECRET: 'admin-secret',
        LOCAL_SUPPORT_EMAIL: 'support@zongo.app',
        LOCAL_SUPPORT_TOTP_SECRET: 'support-secret',
        LOCAL_OPS_EMAIL: 'ops@zongo.app',
        LOCAL_OPS_TOTP_SECRET: 'ops-secret',
      }),
    ).toEqual([
      {
        email: 'admin@zongo.app',
        totpSecret: 'admin-secret',
        role: AdminRole.ADMIN,
      },
      {
        email: 'support@zongo.app',
        totpSecret: 'support-secret',
        role: AdminRole.SUPPORT,
      },
      {
        email: 'ops@zongo.app',
        totpSecret: 'ops-secret',
        role: AdminRole.OPS,
      },
    ]);
    expect(
      localAdminConfigsFromEnvironment({
        LOCAL_ADMIN_EMAIL: 'admin@zongo.app',
        LOCAL_ADMIN_TOTP_SECRET: 'admin-secret',
        LOCAL_SUPPORT_EMAIL: 'support@zongo.app',
      }),
    ).toHaveLength(1);
  });
});
