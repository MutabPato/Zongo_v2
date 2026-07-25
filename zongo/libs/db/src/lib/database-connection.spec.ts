import { databasePoolConfig, databaseUrl } from './database-connection';

describe('database connection configuration', () => {
  const environment = {
    POSTGRES_HOST: 'postgres',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'zongo',
    POSTGRES_PASSWORD: 'p@ss:word/with?reserved#chars%',
    POSTGRES_DB: 'zongo',
  };

  it('uses the encoded URL for the runtime client', () => {
    const config = databasePoolConfig(environment);

    expect(config.connectionString).toBe(databaseUrl(environment));
    expect(new URL(config.connectionString!).password).toBe(
      encodeURIComponent(environment.POSTGRES_PASSWORD),
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
