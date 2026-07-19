import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function databaseUrl(environment: NodeJS.ProcessEnv): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;

  const required = [
    'POSTGRES_HOST',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
  ] as const;
  const missing = required.filter((name) => !environment[name]);

  if (missing.length > 0) {
    throw new Error(`DATABASE_URL or ${missing.join(', ')} must be configured`);
  }

  const url = new URL(
    `postgresql://${encodeURIComponent(environment.POSTGRES_USER!)}:${encodeURIComponent(environment.POSTGRES_PASSWORD!)}@${environment.POSTGRES_HOST}:${environment.POSTGRES_PORT ?? '5432'}/${environment.POSTGRES_DB}`,
  );
  url.searchParams.set('schema', environment.POSTGRES_SCHEMA ?? 'public');
  return url.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl(process.env),
  },
});
