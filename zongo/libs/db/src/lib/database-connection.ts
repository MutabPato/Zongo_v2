import type { PoolConfig } from 'pg';

type Environment = NodeJS.ProcessEnv;

const requiredDatabaseVariables = [
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
] as const;

export function databasePoolConfig(environment: Environment): PoolConfig {
  const hasComponentConfiguration = requiredDatabaseVariables.every(
    (name) => environment[name],
  );

  if (hasComponentConfiguration) {
    return {
      host: environment.POSTGRES_HOST,
      port: Number(environment.POSTGRES_PORT ?? '5432'),
      user: environment.POSTGRES_USER,
      password: environment.POSTGRES_PASSWORD,
      database: environment.POSTGRES_DB,
    };
  }

  if (environment.DATABASE_URL) {
    return { connectionString: environment.DATABASE_URL };
  }

  throw new Error(
    'Configure POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB, or DATABASE_URL',
  );
}

export function databaseUrl(environment: Environment): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;

  const config = databasePoolConfig(environment);
  if (!config.host || !config.user || !config.password || !config.database) {
    throw new Error('DATABASE_URL is required');
  }

  const url = new URL(
    `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(String(config.password))}@${config.host}:${config.port ?? 5432}/${config.database}`,
  );
  url.searchParams.set('schema', environment.POSTGRES_SCHEMA ?? 'public');
  return url.toString();
}
