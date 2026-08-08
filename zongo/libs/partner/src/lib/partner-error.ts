import { PartnerError } from '@app/domain';

export { PartnerError };

export function normalizePartnerError(error: unknown): PartnerError {
  if (error instanceof PartnerError) return error;

  const message =
    error instanceof Error ? error.message : 'Unknown partner error';
  const httpStatus =
    typeof error === 'object' && error !== null && 'httpStatus' in error
      ? Number((error as { httpStatus?: unknown }).httpStatus)
      : undefined;
  const code = /timed?\s*out|temporar|unavailable|network/i.test(message)
    ? 'TEMPORARY_FAILURE'
    : 'REQUEST_FAILED';
  const retryable =
    code === 'TEMPORARY_FAILURE' ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    (httpStatus !== undefined && httpStatus >= 500);
  return new PartnerError(code, message, retryable);
}
