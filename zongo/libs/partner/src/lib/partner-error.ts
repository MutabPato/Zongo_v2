import { DomainError } from '@app/domain';

export class PartnerError extends DomainError {
  constructor(code: string, message: string) {
    super(`PARTNER_${code}`, message);
  }
}

export function normalizePartnerError(
  errorCode: string,
  errorMessage: string,
): PartnerError {
  return new PartnerError(errorCode, errorMessage);
}
