import { databasePoolConfig, databaseUrl } from './database-connection';

describe('database connection configuration', () => {
  const environment = {
    POSTGRES_HOST: 'postgres',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'zongo',
    POSTGRES_PASSWORD: 'p@ss:word/with?reserved#chars%',
    POSTGRES_DB: 'zongo',
  };

  it('passes the raw password to the runtime client', () => {
    expect(databasePoolConfig(environment).password).toBe(
      environment.POSTGRES_PASSWORD,
    );
  });

  it('encodes the password only when producing a Prisma URL', () => {
    const url = new URL(databaseUrl(environment));

    expect(decodeURIComponent(url.password)).toBe(
      environment.POSTGRES_PASSWORD,
    );
    expect(url.searchParams.get('schema')).toBe('public');
  });
});
