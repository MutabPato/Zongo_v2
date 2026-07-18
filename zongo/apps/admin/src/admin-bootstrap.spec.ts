/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { assertBootstrapEnabled, bootstrapAdmin } from './admin-bootstrap';

describe('bootstrapAdmin', () => {
  it('requires an explicit bootstrap approval flag', () => {
    expect(() => assertBootstrapEnabled(undefined)).toThrow(
      'ALLOW_ADMIN_BOOTSTRAP=true is required',
    );
    expect(() => assertBootstrapEnabled('true')).not.toThrow();
  });

  it('refuses to alter an existing identity', async () => {
    const create = jest.fn();
    const prisma = {
      platformIdentity: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing_identity' }),
        create,
      },
    };

    await expect(
      bootstrapAdmin(prisma as never, {
        email: 'admin@zongo.app',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).rejects.toThrow('already exists');

    expect(create).not.toHaveBeenCalled();
  });

  it('creates an admin and records an audit event without the TOTP secret', async () => {
    const createIdentity = jest.fn().mockResolvedValue({ id: 'admin_1' });
    const createAuditEvent = jest.fn().mockResolvedValue({ id: 'audit_1' });
    const transaction = {
      platformIdentity: { create: createIdentity },
      auditEvent: { create: createAuditEvent },
    };
    const prisma = {
      platformIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(transaction)),
    };

    await bootstrapAdmin(prisma as never, {
      email: 'admin@zongo.app',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });

    expect(createIdentity).toHaveBeenCalledWith({
      data: {
        userId: 'admin@zongo.app',
        role: 'ADMIN',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'admin.bootstrap.created',
          actorType: 'SYSTEM',
          actorId: 'admin_1',
          payload: { email: 'admin@zongo.app', role: 'ADMIN' },
        }),
      }),
    );
    expect(JSON.stringify(createAuditEvent.mock.calls)).not.toContain(
      'JBSWY3DPEHPK3PXP',
    );
  });
});
