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

/** A partner-authoritative transfer state used by an operational recheck. */
export type PartnerStatusResult =
  | {
      readonly success: true;
      readonly status:
        | 'PENDING_COLLECTION'
        | 'COLLECTION_SUCCESS'
        | 'COLLECTION_FAILED'
        | 'PENDING_PAYOUT'
        | 'PAYOUT_SUCCESS'
        | 'PAYOUT_FAILED';
      readonly partnerReference?: string;
    }
  | { readonly success: false; readonly error: PartnerError };

/** Stable application-facing boundary for payment partners. */
export interface PartnerPort {
  collect(request: PartnerCollectionRequest): Promise<PartnerResult>;
  payout(request: PartnerPayoutRequest): Promise<PartnerResult>;
  status(reference: string): Promise<PartnerStatusResult>;
}

export const PARTNER_PORT = Symbol('PARTNER_PORT');
