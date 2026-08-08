import { PartnerError } from '@app/domain';

export { PartnerError };

function safeProviderMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (
    /[{}[\]]/.test(message) ||
    /authorization|api[-_ ]?key|token|secret|password|phone|email|account/i.test(
      message,
    )
  )
    return 'Partner request failed';
  return compact || 'Partner request failed';
}

export function normalizePartnerError(error: unknown): PartnerError {
  if (error instanceof PartnerError) return error;

  const rawMessage =
    error instanceof Error ? error.message : 'Unknown partner error';
  const message = safeProviderMessage(rawMessage);
  const httpStatus =
    typeof error === 'object' && error !== null && 'httpStatus' in error
      ? Number((error as { httpStatus?: unknown }).httpStatus)
      : undefined;
  const code = /timed?\s*out|temporar|unavailable|network/i.test(rawMessage)
    ? 'TEMPORARY_FAILURE'
    : 'REQUEST_FAILED';
  const retryable =
    code === 'TEMPORARY_FAILURE' ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    (httpStatus !== undefined && httpStatus >= 500);
  return new PartnerError(code, message, retryable);
}
