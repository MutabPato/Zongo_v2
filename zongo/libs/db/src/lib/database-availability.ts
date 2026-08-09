/** Returns true only for failures that indicate the database cannot serve work. */
export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message =
    typeof candidate.message === 'string' ? candidate.message : '';
  const code = typeof candidate.code === 'string' ? candidate.code : '';

  if (
    [
      'PrismaClientInitializationError',
      'PrismaClientRustPanicError',
      'PrismaClientUnknownRequestError',
    ].includes(name)
  )
    return true;
  if (code === 'P2024') return true;
  return /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|connection (?:refused|terminated|closed|unavailable)/i.test(
    message,
  );
}
