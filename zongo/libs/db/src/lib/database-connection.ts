import type { PoolConfig } from 'pg';

type Environment = NodeJS.ProcessEnv;

const requiredDatabaseVariables = [
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
] as const;

export function databasePoolConfig(environment: Environment): PoolConfig {
  if (environment.DATABASE_URL) {
    return { connectionString: environment.DATABASE_URL };
  }

  const missing = requiredDatabaseVariables.filter(
    (name) => !environment[name],
  );
  if (missing.length > 0) {
    throw new Error(
      'Configure POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB, or DATABASE_URL',
    );
  }

  return { connectionString: databaseUrl(environment) };
}

export function databaseUrl(environment: Environment): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;

  const missing = requiredDatabaseVariables.filter(
    (name) => !environment[name],
  );
  if (missing.length > 0) {
    throw new Error(
      'Configure POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB, or DATABASE_URL',
    );
  }

  const url = new URL(
    `postgresql://${encodeURIComponent(environment.POSTGRES_USER!)}:${encodeURIComponent(environment.POSTGRES_PASSWORD!)}@${environment.POSTGRES_HOST}:${environment.POSTGRES_PORT ?? '5432'}/${environment.POSTGRES_DB}`,
  );
  url.searchParams.set('schema', environment.POSTGRES_SCHEMA ?? 'public');
  return url.toString();
}
