import { AdminV1Controller } from './admin-v1.controller';

describe('AdminV1Controller', () => {
  it('establishes an HttpOnly browser session without returning a bearer token', async () => {
    const admin = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'raw-token-never-returned',
        expiresAt: new Date('2026-08-09T10:00:00.000Z'),
      }),
    };
    const controller = new AdminV1Controller(admin as never, {} as never);
    const cookie = jest.fn();

    const result = await controller.login(
      { userId: 'ops@example.test', totpCode: '123456' },
      { cookie } as never,
    );

    expect(result).toEqual({ expiresAt: new Date('2026-08-09T10:00:00.000Z') });
    expect(JSON.stringify(result)).not.toContain('raw-token-never-returned');
    expect(cookie).toHaveBeenCalledWith(
      'zongo_admin_session',
      'raw-token-never-returned',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });

  it('returns a session-bound CSRF token for an authenticated cookie session', async () => {
    const admin = {
      actorFromSession: jest.fn().mockResolvedValue({ id: 'ops_1' }),
      csrfToken: jest.fn().mockReturnValue('csrf-token'),
    };
    const controller = new AdminV1Controller(admin as never, {} as never);

    await expect(
      controller.csrf({
        headers: { cookie: 'zongo_admin_session=session-token' },
      } as never),
    ).resolves.toEqual({ token: 'csrf-token' });
    expect(admin.actorFromSession).toHaveBeenCalledWith('session-token');
  });

  it('requires the session-bound CSRF token for WebAuthn registration verification', async () => {
    const admin = {
      csrfToken: jest.fn().mockReturnValue('csrf-token'),
      actorFromSession: jest.fn().mockResolvedValue({ id: 'ops_1' }),
    };
    const webauthn = {
      verifyRegistration: jest.fn().mockResolvedValue({ verified: true }),
    };
    const controller = new AdminV1Controller(admin as never, webauthn as never);

    await expect(
      controller.verifyHardwareKeyRegistration(
        {
          headers: { cookie: 'zongo_admin_session=session-token' },
        } as never,
        { response: { id: 'credential' } } as never,
      ),
    ).rejects.toThrow();
    expect(webauthn.verifyRegistration).not.toHaveBeenCalled();
  });

  it('requires CSRF for browser logout and clears the session cookie', async () => {
    const admin = {
      csrfToken: jest.fn().mockReturnValue('csrf-token'),
      assertCsrfToken: jest.fn(),
      logoutSession: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminV1Controller(admin as never, {} as never);
    const clearCookie = jest.fn();

    await controller.logout(
      {
        headers: {
          cookie: 'zongo_admin_session=session-token',
        },
      } as never,
      { clearCookie } as never,
      'csrf-token',
    );

    expect(admin.assertCsrfToken).toHaveBeenCalledWith(
      'session-token',
      'csrf-token',
    );
    expect(admin.logoutSession).toHaveBeenCalledWith('session-token');
    expect(clearCookie).toHaveBeenCalledWith(
      'zongo_admin_session',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});
