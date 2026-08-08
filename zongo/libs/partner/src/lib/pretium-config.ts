export type PretiumRuntimeConfiguration = {
  status: 'PASS' | 'INCOMPLETE';
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL';
    configured: boolean;
  }>;
};

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function validHttpsUrl(value: string | undefined): boolean {
  if (!configured(value)) return false;
  try {
    return new URL(value!).protocol === 'https:';
  } catch {
    return false;
  }
}

export function verifyPretiumRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): PretiumRuntimeConfiguration {
  const checks = [
    {
      name: 'base-url-is-https',
      configured: validHttpsUrl(environment.PRETIUM_BASE_URL),
    },
    {
      name: 'consumer-key-present',
      configured: configured(environment.PRETIUM_CONSUMER_KEY),
    },
    {
      name: 'webhook-url-is-https',
      configured: validHttpsUrl(environment.PRETIUM_WEBHOOK_URL),
    },
    {
      name: 'webhook-secret-present',
      configured: configured(environment.PRETIUM_WEBHOOK_SECRET),
    },
    {
      name: 'cdf-rail-explicitly-enabled',
      configured: environment.PRETIUM_CDF_ENABLED === 'true',
    },
    {
      name: 'kes-rail-explicitly-enabled',
      configured: environment.PRETIUM_KES_ENABLED === 'true',
    },
    {
      name: 'production-no-sandbox-confirmed',
      configured:
        environment.PRETIUM_ENVIRONMENT === 'production' &&
        environment.PRETIUM_NO_SANDBOX_CONFIRMED === 'true',
    },
  ].map((check) => ({
    ...check,
    status: check.configured ? ('PASS' as const) : ('FAIL' as const),
  }));

  return {
    status: checks.every((check) => check.status === 'PASS')
      ? 'PASS'
      : 'INCOMPLETE',
    checks,
  };
}
