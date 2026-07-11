export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class PartnerError extends DomainError {
  constructor(
    code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`PARTNER_${code}`, message);
    this.name = 'PartnerError';
  }
}
