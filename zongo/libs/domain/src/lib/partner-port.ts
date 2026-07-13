import type { PartnerError } from './domain-error';

export interface PartnerCollectionRequest {
  readonly reference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly beneficiaryId: string;
}

export type PartnerPayoutRequest = PartnerCollectionRequest;

export type PartnerResult =
  | { readonly success: true; readonly partnerReference: string }
  | { readonly success: false; readonly error: PartnerError };

/** Stable application-facing boundary for payment partners. */
export interface PartnerPort {
  collect(request: PartnerCollectionRequest): Promise<PartnerResult>;
  payout(request: PartnerPayoutRequest): Promise<PartnerResult>;
  getTransferStatus(reference: string): Promise<'RESOLVED' | 'AMBIGUOUS'>;
}

export const PARTNER_PORT = Symbol('PARTNER_PORT');
