import { PartnerError } from '@app/domain';

export { PartnerError };

export function normalizePartnerError(error: unknown): PartnerError {
  if (error instanceof PartnerError) return error;

  const message =
    error instanceof Error ? error.message : 'Unknown partner error';
  const code = /timed?\s*out|temporar|unavailable|network/i.test(message)
    ? 'TEMPORARY_FAILURE'
    : 'REQUEST_FAILED';
  return new PartnerError(code, message, code === 'TEMPORARY_FAILURE');
}
