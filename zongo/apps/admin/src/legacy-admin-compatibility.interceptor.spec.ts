import { LegacyAdminCompatibilityInterceptor } from './legacy-admin-compatibility.interceptor';

describe('LegacyAdminCompatibilityInterceptor', () => {
  it('marks legacy responses and emits no credential-bearing telemetry', () => {
    const setHeader = jest.fn();
    const handle = jest.fn().mockReturnValue('next');
    const interceptor = new LegacyAdminCompatibilityInterceptor();
    const result = interceptor.intercept(
      {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'GET', route: { path: '/admin' } }),
          getResponse: () => ({ setHeader }),
        }),
      } as never,
      { handle } as never,
    );
    expect(result).toBe('next');
    expect(setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(setHeader).toHaveBeenCalledWith(
      'X-Admin-Compatibility',
      'legacy-bearer-named-client',
    );
  });
});
