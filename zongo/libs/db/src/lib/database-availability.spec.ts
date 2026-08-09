import { isDatabaseUnavailableError } from './database-availability';

describe('database availability classification', () => {
  it('recognizes connection and pool exhaustion failures', () => {
    expect(
      isDatabaseUnavailableError(new Error('connect ECONNREFUSED 127.0.0.1')),
    ).toBe(true);
    expect(
      isDatabaseUnavailableError({ code: 'P2024', message: 'pool timeout' }),
    ).toBe(true);
  });

  it('does not classify domain or partner failures as database outages', () => {
    expect(
      isDatabaseUnavailableError(new Error('invalid lifecycle transition')),
    ).toBe(false);
    expect(
      isDatabaseUnavailableError({
        name: 'PretiumHttpError',
        message: 'timeout',
      }),
    ).toBe(false);
  });
});
