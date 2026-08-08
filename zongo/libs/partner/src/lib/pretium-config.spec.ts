import { verifyPretiumRuntimeConfiguration } from './pretium-config';

describe('Pretium runtime configuration', () => {
  it('does not pass without the production webhook and rail evidence', () => {
    const result = verifyPretiumRuntimeConfiguration({
      PRETIUM_BASE_URL: 'https://api.pretium.africa',
      PRETIUM_CONSUMER_KEY: 'configured-at-runtime',
      PRETIUM_WEBHOOK_SECRET: 'configured-at-runtime',
    });

    expect(result.status).toBe('INCOMPLETE');
    expect(
      result.checks.find((check) => check.name === 'webhook-url-is-https')
        ?.status,
    ).toBe('FAIL');
  });

  it('passes only with explicit production, rail, and no-sandbox assertions', () => {
    const result = verifyPretiumRuntimeConfiguration({
      PRETIUM_BASE_URL: 'https://api.pretium.africa',
      PRETIUM_CONSUMER_KEY: 'configured-at-runtime',
      PRETIUM_WEBHOOK_URL: 'https://api.example.test/webhooks/pretium',
      PRETIUM_WEBHOOK_SECRET: 'configured-at-runtime',
      PRETIUM_CDF_ENABLED: 'true',
      PRETIUM_KES_ENABLED: 'true',
      PRETIUM_ENVIRONMENT: 'production',
      PRETIUM_NO_SANDBOX_CONFIRMED: 'true',
    });

    expect(result.status).toBe('PASS');
  });
});
